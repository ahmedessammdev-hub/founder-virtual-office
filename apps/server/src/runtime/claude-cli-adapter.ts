import { spawn } from "node:child_process";
import readline from "node:readline";
import type { RuntimeProvider } from "@virtual-office/shared";
import { sanitizeAndSpillOutput } from "../governance/output-guard.js";
import { classifyCliError } from "./agy-cli-adapter.js";
import { buildSafeChildEnv, resolveExecutable } from "./env-builder.js";
import { killProcessTree } from "./process-killer.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

export class ClaudeCliAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider = "claude";

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    const exe = resolveExecutable("claude");
    if (!exe) {
      emit({
        type: "error",
        errorCode: "CLI_CRASH",
        message: "claude CLI binary not found in PATH.",
        recoverable: false,
      });
      return;
    }

    const permissionMode = input.riskTier === "tier2_guarded" ? "acceptEdits" : "plan";
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      input.model,
      "--permission-mode",
      permissionMode,
    ];

    if (input.conversation.externalSessionId && input.conversation.runtimeProvider === "claude") {
      args.push("--resume", input.conversation.externalSessionId);
    }

    const extraEnv: Record<string, string> = {};
    if (input.officeMcpUrl && input.officeRunToken) {
      extraEnv.OFFICE_MCP_URL = input.officeMcpUrl;
      extraEnv.OFFICE_RUN_TOKEN = input.officeRunToken;
    }

    const child = spawn(exe, args, {
      cwd: input.workingDir,
      env: buildSafeChildEnv(input.employee.permissions.grantedEnvKeys, extraEnv),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      void killProcessTree(child.pid);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const stderrChunks: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderrChunks.length < 64) {
        stderrChunks.push(chunk);
      }
    });

    let accumulatedText = "";
    let doneEmitted = false;
    let errorEmitted = false;
    let toolCounter = 0;

    child.stdout.setEncoding("utf8");
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    rl.on("line", (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        emit({ type: "warning", message: `claude non-JSON stdout: ${line.slice(0, 200)}` });
        return;
      }

      const kind = String(parsed.type ?? "");
      if (kind === "system" && parsed.subtype === "init") {
        if (typeof parsed.session_id === "string") {
          emit({ type: "session_id", sessionId: parsed.session_id, provider: "claude" });
        }
        emit({ type: "status", status: "running", detail: `Claude (${input.model})` });
        return;
      }

      if (kind === "assistant" && parsed.message && typeof parsed.message === "object") {
        const msg = parsed.message as { content?: unknown[] };
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (!block || typeof block !== "object") continue;
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              accumulatedText += b.text;
              emit({ type: "text_delta", text: b.text });
            } else if (b.type === "thinking" && typeof b.thinking === "string") {
              emit({ type: "thinking", text: b.thinking });
            } else if (b.type === "tool_use") {
              emit({
                type: "tool_call",
                toolName: String(b.name ?? "claude_tool"),
                args: b.input && typeof b.input === "object"
                  ? (b.input as Record<string, unknown>)
                  : {},
              });
            }
          }
        }
        return;
      }

      if (kind === "user" && parsed.message && typeof parsed.message === "object") {
        const msg = parsed.message as { content?: unknown[] };
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (!block || typeof block !== "object") continue;
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result") {
              toolCounter += 1;
              const rawContent =
                typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
              const guarded = sanitizeAndSpillOutput({
                runId: input.runId,
                stepKey: `claude_tool_${toolCounter}`,
                rawText: rawContent,
                artifactsDir: input.artifactsDir,
              });
              emit({
                type: "tool_result",
                toolName: String(b.tool_use_id ?? "claude_tool"),
                success: !b.is_error,
                outputPreview: guarded.preview,
                artifactPath: guarded.artifactPath,
                truncated: guarded.truncated,
              });
            }
          }
        }
        return;
      }

      if (kind === "result") {
        if (typeof parsed.session_id === "string") {
          emit({ type: "session_id", sessionId: parsed.session_id, provider: "claude" });
        }
        const usageObj = parsed.usage as Record<string, unknown> | undefined;
        const inTok = Number(usageObj?.input_tokens ?? 0);
        const outTok = Number(usageObj?.output_tokens ?? 0);
        const costUsd =
          typeof parsed.total_cost_usd === "number"
            ? parsed.total_cost_usd
            : Number(((inTok * 0.000003) + (outTok * 0.000015)).toFixed(6));
        emit({
          type: "usage",
          inputTokens: inTok,
          outputTokens: outTok,
          costUsd,
          mode: input.mode,
        });

        if (parsed.is_error) {
          errorEmitted = true;
          const msg = String(parsed.result ?? "Claude CLI error");
          emit({
            type: "error",
            errorCode: classifyCliError(msg),
            message: msg,
            recoverable: false,
          });
        } else {
          doneEmitted = true;
          const finalResp =
            typeof parsed.result === "string" && parsed.result.length > 0
              ? parsed.result
              : accumulatedText;
          emit({ type: "done", finalOutput: finalResp });
        }
      }
    });

    child.stdin.write(input.assembled.composedPrompt, "utf8");
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("error", (err) => {
        if (!aborted && !errorEmitted) {
          errorEmitted = true;
          emit({
            type: "error",
            errorCode: "CLI_CRASH",
            message: `Failed to launch claude: ${err.message}`,
            recoverable: false,
          });
        }
        resolve(1);
      });
      child.on("close", (code) => resolve(code));
    });

    signal.removeEventListener("abort", onAbort);
    rl.close();

    if (aborted) return;

    if (exitCode !== 0 && !errorEmitted) {
      const stderrText = stderrChunks.join("").trim();
      emit({
        type: "error",
        errorCode: classifyCliError(stderrText || `Exit code ${exitCode}`),
        message: stderrText || `claude exited with code ${exitCode}`,
        recoverable: false,
      });
      return;
    }

    if (!doneEmitted && !errorEmitted) {
      emit({ type: "done", finalOutput: accumulatedText });
    }
  }
}
