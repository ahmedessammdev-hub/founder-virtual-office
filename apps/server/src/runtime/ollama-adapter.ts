import readline from "node:readline";
import { Readable } from "node:stream";
import type { RuntimeProvider } from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { PolicyGuard } from "../governance/policy-guard.js";
import type { CredentialVault } from "../governance/vault.js";
import {
  BUILT_IN_TOOL_DEFINITIONS,
  executeBuiltInGatewayTool,
} from "../mcp/gateway-tools.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

export interface OllamaAdapterDeps {
  baseUrl?: string;
  companyStore: CompanyStore;
  memoryRepo: MemoryRepository;
  tasksRepo: TasksRepository;
  vault: CredentialVault;
  policyGuard: PolicyGuard;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

export class OllamaAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider = "ollama";
  private readonly baseUrl: string;

  constructor(private readonly deps: OllamaAdapterDeps) {
    this.baseUrl = (deps.baseUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  }

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    emit({ type: "status", status: "running", detail: `Ollama (${input.model})` });

    const messages: OllamaMessage[] = [
      { role: "user", content: input.assembled.composedPrompt },
    ];

    const tools = BUILT_IN_TOOL_DEFINITIONS.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    let finalOutput = "";
    let totalIn = 0;
    let totalOut = 0;
    let stepCounter = 0;
    let tainted = input.assembled.hasUntrustedExternalInput;

    for (let turn = 0; turn < 6; turn += 1) {
      if (signal.aborted) return;

      let resp: Response;
      try {
        resp = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            model: input.model,
            messages,
            tools,
            stream: true,
          }),
        });
      } catch (err) {
        if (signal.aborted) return;
        emit({
          type: "error",
          errorCode: "NETWORK_ERROR",
          message: `Cannot reach Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: false,
        });
        return;
      }

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        emit({
          type: "error",
          errorCode: resp.status === 429 ? "RATE_LIMITED" : "CLI_CRASH",
          message: `Ollama returned HTTP ${resp.status}: ${errText.slice(0, 300)}`,
          recoverable: false,
        });
        return;
      }

      let turnText = "";
      const turnToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const nodeStream = Readable.fromWeb(resp.body as unknown as import("node:stream/web").ReadableStream);
      const rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });

      for await (const rawLine of rl) {
        if (signal.aborted) {
          rl.close();
          return;
        }
        const line = rawLine.trim();
        if (!line) continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        const msg = chunk.message as
          | {
              content?: string;
              tool_calls?: Array<{
                function?: { name?: string; arguments?: Record<string, unknown> };
              }>;
            }
          | undefined;

        if (msg?.content) {
          turnText += msg.content;
          finalOutput += msg.content;
          emit({ type: "text_delta", text: msg.content });
        }

        if (Array.isArray(msg?.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (tc.function?.name) {
              turnToolCalls.push({
                name: tc.function.name,
                args: tc.function.arguments ?? {},
              });
            }
          }
        }

        if (chunk.done) {
          totalIn += Number(chunk.prompt_eval_count ?? 0);
          totalOut += Number(chunk.eval_count ?? 0);
        }
      }

      if (turnToolCalls.length === 0) {
        emit({
          type: "usage",
          inputTokens: totalIn,
          outputTokens: totalOut,
          costUsd: 0,
          mode: input.mode,
        });
        emit({ type: "done", finalOutput });
        return;
      }

      messages.push({
        role: "assistant",
        content: turnText,
        tool_calls: turnToolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        })),
      });

      for (const tc of turnToolCalls) {
        stepCounter += 1;
        emit({ type: "tool_call", toolName: tc.name, args: tc.args });
        if (signal.aborted) return;

        const policy = this.deps.policyGuard.evaluate({
          employeeId: input.employee.profile.id,
          toolName: tc.name,
          projectId: input.project?.id ?? null,
        });

        if (policy.outcome === "require_approval") {
          emit({
            type: "approval_requested",
            actionType: tc.name,
            riskTier: "tier3_approval",
            title: `Approval required: ${tc.name}`,
            summary: policy.reason,
            payload: tc.args,
          });
          return;
        }

        if (policy.outcome === "deny") {
          emit({
            type: "tool_result",
            toolName: tc.name,
            success: false,
            outputPreview: policy.reason,
          });
          messages.push({ role: "tool", content: `DENIED: ${policy.reason}` });
          continue;
        }

        const res = await executeBuiltInGatewayTool(
          {
            runId: input.runId,
            employeeId: input.employee.profile.id,
            projectId: input.project?.id ?? null,
            workingDir: input.workingDir,
            artifactsDir: input.artifactsDir,
            companyStore: this.deps.companyStore,
            memoryRepo: this.deps.memoryRepo,
            tasksRepo: this.deps.tasksRepo,
            vault: this.deps.vault,
            markTainted: () => {
              tainted = true;
            },
          },
          tc.name,
          tc.args,
          stepCounter,
        );

        emit({
          type: "tool_result",
          toolName: tc.name,
          success: res.success,
          outputPreview: res.output,
          artifactPath: res.artifactPath,
          truncated: res.truncated,
        });

        messages.push({
          role: "tool",
          content: tainted ? `[EXTERNAL_TAINTED] ${res.output}` : res.output,
        });
      }
    }

    emit({
      type: "usage",
      inputTokens: totalIn,
      outputTokens: totalOut,
      costUsd: 0,
      mode: input.mode,
    });
    emit({ type: "done", finalOutput });
  }
}
