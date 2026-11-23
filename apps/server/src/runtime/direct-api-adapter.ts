import type { RunErrorCode, RuntimeProvider } from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { PolicyGuard } from "../governance/policy-guard.js";
import type { CredentialVault } from "../governance/vault.js";
import {
  BUILT_IN_TOOL_DEFINITIONS,
  executeBuiltInGatewayTool,
} from "../mcp/gateway-tools.js";
import type { McpManager } from "../mcp/mcp-manager.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

export type DirectApiProvider =
  | "gemini_api"
  | "openai_api"
  | "anthropic_api"
  | "openrouter_api";

export interface DirectApiDeps {
  companyStore: CompanyStore;
  memoryRepo: MemoryRepository;
  tasksRepo: TasksRepository;
  vault: CredentialVault;
  policyGuard: PolicyGuard;
  mcpManager: McpManager;
  baseUrls?: Partial<Record<DirectApiProvider, string>>;
}

interface UnifiedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface UnifiedTurnResponse {
  text: string;
  toolCalls: UnifiedToolCall[];
  inputTokens: number;
  outputTokens: number;
}

const PROVIDER_SECRET_KEY: Record<DirectApiProvider, string> = {
  gemini_api: "GEMINI_API_KEY",
  openai_api: "OPENAI_API_KEY",
  anthropic_api: "ANTHROPIC_API_KEY",
  openrouter_api: "OPENROUTER_API_KEY",
};

const DEFAULT_BASE_URLS: Record<DirectApiProvider, string> = {
  gemini_api: "https://generativelanguage.googleapis.com/v1beta",
  openai_api: "https://api.openai.com/v1",
  anthropic_api: "https://api.anthropic.com/v1",
  openrouter_api: "https://openrouter.ai/api/v1",
};

function estimateUsdCost(
  provider: DirectApiProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const lower = model.toLowerCase();
  let inPerM = 2.0;
  let outPerM = 8.0;

  if (lower.includes("flash") || lower.includes("mini") || lower.includes("haiku")) {
    inPerM = 0.25;
    outPerM = 1.0;
  } else if (lower.includes("opus") || provider === "anthropic_api") {
    inPerM = 3.0;
    outPerM = 15.0;
  } else if (provider === "gemini_api") {
    inPerM = 1.25;
    outPerM = 5.0;
  }

  return Number((((inputTokens / 1_000_000) * inPerM) + ((outputTokens / 1_000_000) * outPerM)).toFixed(6));
}

function classifyHttpStatus(status: number, bodyText: string): RunErrorCode {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("unauthorized")) {
    return "AUTH_REQUIRED";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "RATE_LIMITED";
  }
  if (status === 402 || lower.includes("quota") || lower.includes("insufficient_quota") || lower.includes("credit")) {
    return "QUOTA_EXCEEDED";
  }
  return "NETWORK_ERROR";
}

interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: UnifiedToolCall[];
}

export class DirectApiAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider;

  constructor(
    private readonly apiProvider: DirectApiProvider,
    private readonly deps: DirectApiDeps,
  ) {
    this.provider = apiProvider;
  }

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    const secretKeyName = PROVIDER_SECRET_KEY[this.apiProvider];
    const apiKey = this.deps.vault.resolveSecret(secretKeyName);
    if (!apiKey) {
      emit({
        type: "error",
        errorCode: "AUTH_REQUIRED",
        message: `Missing API key "${secretKeyName}". Add it in Providers & Cost -> Encrypted API Keys Vault.`,
        recoverable: false,
      });
      return;
    }

    emit({ type: "status", status: "running", detail: `${this.apiProvider} (${input.model})` });

    const history: ConversationMessage[] = [
      { role: "user", content: input.assembled.composedPrompt },
    ];

    let finalText = "";
    let stepCounter = 0;
    const maxTurns = Math.min(8, input.employee.permissions.maxStepsPerRun);

    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (signal.aborted) return;

      let turnRes: UnifiedTurnResponse;
      try {
        turnRes = await this.invokeProviderTurn(apiKey, input.model, history, signal);
      } catch (err) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof HttpApiError ? err.errorCode : ("NETWORK_ERROR" as RunErrorCode);
        emit({ type: "error", errorCode: code, message: msg, recoverable: code === "RATE_LIMITED" });
        return;
      }

      const costUsd = estimateUsdCost(
        this.apiProvider,
        input.model,
        turnRes.inputTokens,
        turnRes.outputTokens,
      );
      emit({
        type: "usage",
        inputTokens: turnRes.inputTokens,
        outputTokens: turnRes.outputTokens,
        costUsd,
        mode: input.mode,
      });
      if (signal.aborted) return;

      if (turnRes.text) {
        finalText += (finalText ? "\n" : "") + turnRes.text;
        emit({ type: "text_delta", text: turnRes.text });
      }

      if (turnRes.toolCalls.length === 0) {
        emit({ type: "done", finalOutput: finalText });
        return;
      }

      history.push({
        role: "assistant",
        content: turnRes.text,
        toolCalls: turnRes.toolCalls,
      });

      for (const tc of turnRes.toolCalls) {
        stepCounter += 1;
        emit({ type: "tool_call", toolName: tc.name, args: tc.args });
        if (signal.aborted) return;

        // Tier 3 explicit approval request tool or PolicyGuard require_approval
        if (tc.name === "office_request_approval") {
          emit({
            type: "approval_requested",
            actionType: String(tc.args.actionType ?? "external_action"),
            riskTier: "tier3_approval",
            title: String(tc.args.title ?? "Approval requested"),
            summary: String(tc.args.summary ?? "Requested via Direct API agent"),
            payload:
              tc.args.payload && typeof tc.args.payload === "object"
                ? (tc.args.payload as Record<string, unknown>)
                : tc.args,
          });
          return;
        }

        const mcpMatch = /^mcp__([^_]+)__(.+)$/.exec(tc.name);
        if (mcpMatch) {
          const [, serverId, mcpTool] = mcpMatch;
          const res = await this.deps.mcpManager.callTool({
            serverId: serverId!,
            toolName: mcpTool!,
            args: tc.args,
            employeeId: input.employee.profile.id,
            runId: input.runId,
            projectId: input.project?.id ?? null,
          });
          if (res.outcome === "require_approval") {
            emit({
              type: "approval_requested",
              actionType: `mcp:${serverId}:${mcpTool}`,
              riskTier: "tier3_approval",
              title: `Approval required: ${mcpTool}`,
              summary: res.reason ?? "MCP tool requires founder approval",
              payload: { serverId, toolName: mcpTool, args: tc.args },
            });
            return;
          }
          emit({
            type: "tool_result",
            toolName: tc.name,
            success: res.outcome === "executed",
            outputPreview: res.output ?? res.reason ?? "Denied",
            artifactPath: res.artifactPath,
            truncated: res.truncated,
          });
          history.push({
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            content: res.output ?? res.reason ?? "Denied",
          });
          continue;
        }

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
          history.push({
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
            content: `DENIED: ${policy.reason}`,
          });
          continue;
        }

        const result = await executeBuiltInGatewayTool(
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
              // Taint recorded in tool output delimiter; JobSupervisor / ApprovalEngine handles taint checks
            },
          },
          tc.name,
          tc.args,
          stepCounter,
        );

        emit({
          type: "tool_result",
          toolName: tc.name,
          success: result.success,
          outputPreview: result.output,
          artifactPath: result.artifactPath,
          truncated: result.truncated,
        });
        history.push({
          role: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.output,
        });
      }
    }

    emit({ type: "done", finalOutput: finalText });
  }

  private async invokeProviderTurn(
    apiKey: string,
    model: string,
    history: ConversationMessage[],
    signal: AbortSignal,
  ): Promise<UnifiedTurnResponse> {
    const baseUrl = (
      this.deps.baseUrls?.[this.apiProvider] ?? DEFAULT_BASE_URLS[this.apiProvider]
    ).replace(/\/+$/, "");

    if (this.apiProvider === "openai_api" || this.apiProvider === "openrouter_api") {
      return this.callOpenAiCompatible(baseUrl, apiKey, model, history, signal);
    }
    if (this.apiProvider === "anthropic_api") {
      return this.callAnthropic(baseUrl, apiKey, model, history, signal);
    }
    return this.callGemini(baseUrl, apiKey, model, history, signal);
  }

  private async callOpenAiCompatible(
    baseUrl: string,
    apiKey: string,
    model: string,
    history: ConversationMessage[],
    signal: AbortSignal,
  ): Promise<UnifiedTurnResponse> {
    const messages = history.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId ?? "call_1",
          content: msg.content,
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const tools = BUILT_IN_TOOL_DEFINITIONS.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, tools }),
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      throw new HttpApiError(classifyHttpStatus(resp.status, rawText), `HTTP ${resp.status}: ${rawText.slice(0, 300)}`);
    }

    const json = JSON.parse(rawText) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string | Record<string, unknown> };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const msg = json.choices?.[0]?.message;
    const toolCalls: UnifiedToolCall[] = (msg?.tool_calls ?? []).map((tc, idx) => {
      let args: Record<string, unknown> = {};
      if (typeof tc.function?.arguments === "string") {
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (tc.function?.arguments && typeof tc.function.arguments === "object") {
        args = tc.function.arguments;
      }
      return {
        id: tc.id ?? `call_${idx + 1}`,
        name: tc.function?.name ?? "",
        args,
      };
    });

    return {
      text: msg?.content ?? "",
      toolCalls,
      inputTokens: Number(json.usage?.prompt_tokens ?? 0),
      outputTokens: Number(json.usage?.completion_tokens ?? 0),
    };
  }

  private async callAnthropic(
    baseUrl: string,
    apiKey: string,
    model: string,
    history: ConversationMessage[],
    signal: AbortSignal,
  ): Promise<UnifiedTurnResponse> {
    const messages = history.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = [];
        if (msg.content) blocks.push({ type: "text", text: msg.content });
        for (const tc of msg.toolCalls) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
        }
        return { role: "assistant", content: blocks };
      }
      if (msg.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId ?? "call_1",
              content: msg.content,
            },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const tools = BUILT_IN_TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const resp = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 4096, messages, tools }),
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      throw new HttpApiError(classifyHttpStatus(resp.status, rawText), `HTTP ${resp.status}: ${rawText.slice(0, 300)}`);
    }

    const json = JSON.parse(rawText) as {
      content?: Array<{
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    let text = "";
    const toolCalls: UnifiedToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text" && block.text) {
        text += block.text;
      } else if (block.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id ?? `call_${toolCalls.length + 1}`,
          name: block.name,
          args: block.input ?? {},
        });
      }
    }

    return {
      text,
      toolCalls,
      inputTokens: Number(json.usage?.input_tokens ?? 0),
      outputTokens: Number(json.usage?.output_tokens ?? 0),
    };
  }

  private async callGemini(
    baseUrl: string,
    apiKey: string,
    model: string,
    history: ConversationMessage[],
    signal: AbortSignal,
  ): Promise<UnifiedTurnResponse> {
    const contents = history.map((msg) => {
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
        return { role: "model", parts };
      }
      if (msg.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.toolName ?? "tool",
                response: { result: msg.content },
              },
            },
          ],
        };
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      };
    });

    const tools = [
      {
        functionDeclarations: BUILT_IN_TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];

    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, tools }),
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      throw new HttpApiError(classifyHttpStatus(resp.status, rawText), `HTTP ${resp.status}: ${rawText.slice(0, 300)}`);
    }

    const json = JSON.parse(rawText) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: { name?: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    let text = "";
    const toolCalls: UnifiedToolCall[] = [];
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) {
        text += part.text;
      } else if (part.functionCall?.name) {
        toolCalls.push({
          id: `gem_call_${toolCalls.length + 1}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        });
      }
    }

    return {
      text,
      toolCalls,
      inputTokens: Number(json.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Number(json.usageMetadata?.candidatesTokenCount ?? 0),
    };
  }
}

class HttpApiError extends Error {
  constructor(
    public readonly errorCode: RunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpApiError";
  }
}
