import { spawn } from "node:child_process";
import readline from "node:readline";
import type { RunErrorCode, RuntimeProvider } from "@virtual-office/shared";
import { sanitizeAndSpillOutput } from "../governance/output-guard.js";
import { buildSafeChildEnv, resolveExecutable } from "./env-builder.js";
import { killProcessTree } from "./process-killer.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

export function classifyCliError(text: string): RunErrorCode {
  const lower = text.toLowerCase();
  if (
    lower.includes("not authenticated") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("login") ||
    lower.includes("auth")
  ) {
    return "AUTH_REQUIRED";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "RATE_LIMITED";
  }
  if (lower.includes("quota") || lower.includes("insufficient_quota") || lower.includes("billing")) {
    return "QUOTA_EXCEEDED";
  }
  if (lower.includes("sandbox") || lower.includes("permission denied") || lower.includes("eacces")) {
    return "SANDBOX_DENIED";
  }
  if (lower.includes("econn") || lower.includes("network") || lower.includes("timed out") || lower.includes("etimedout")) {
    return "NETWORK_ERROR";
  }
  return "CLI_CRASH";
}

export class AgyCliAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider = "agy";

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    const exe = resolveExecutable("agy");
    if (!exe) {
      emit({
        type: "error",
        errorCode: "CLI_CRASH",
        message: "agy CLI binary not found in PATH.",
        recoverable: false,
      });
      return;
    }

    const modeFlag = input.riskTier === "tier2_guarded" ? "accept-edits" : "plan";
    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--model",
      input.model,
      "--sandbox",
      "--mode",
      modeFlag,
      "--add-dir",
      input.workingDir,
    ];

    const hasEmbeddedEffort = /-(low|medium|high|xhigh|max)$/i.test(input.model);
    if (input.effort && !hasEmbeddedEffort) {
      args.push("--effort", input.effort);
    }
    if (input.conversation.externalSessionId && input.conversation.runtimeProvider === "agy") {
      args.push("--conversation", input.conversation.externalSessionId);
    }
    args.push("--print=");

    const extraEnv: Record<string, string> = {};
    if (input.officeMcpUrl && input.officeRunToken) {
      extraEnv.OFFICE_MCP_URL = input.officeMcpUrl;
      extraEnv.OFFICE_RUN_TOKEN = input.officeRunToken;
    }
    const env = buildSafeChildEnv(input.employee.permissions.grantedEnvKeys, extraEnv);
    const child = spawn(exe, args, {
      cwd: input.workingDir,
      env,
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
    let usageEmitted = false;
    let doneEmitted = false;
    let errorEmitted = false;
    let toolStepCounter = 0;

    child.stdout.setEncoding("utf8");
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    rl.on("line", (rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Defensive handling of any stray non-JSON stdout line
        emit({ type: "warning", message: `agy non-JSON stdout: ${line.slice(0, 200)}` });
        return;
      }

      const eventKind = typeof parsed.event === "string" ? parsed.event : "";
      if (eventKind === "init") {
        const convId = typeof parsed.conversation_id === "string" ? parsed.conversation_id : undefined;
        if (convId) {
          emit({ type: "session_id", sessionId: convId, provider: "agy" });
        }
        emit({ type: "status", status: "running", detail: `AGY (${input.model})` });
        return;
      }

      if (eventKind === "step_update" && parsed.step_update && typeof parsed.step_update === "object") {
        const su = parsed.step_update as Record<string, unknown>;
        const stepType = typeof su.step_type === "string" ? su.step_type : "";
        if (typeof su.text_delta === "string" && su.text_delta.length > 0) {
          accumulatedText += su.text_delta;
          emit({ type: "text_delta", text: su.text_delta });
        }
        if (typeof su.thinking_delta === "string" && su.thinking_delta.length > 0) {
          emit({ type: "thinking", text: su.thinking_delta });
        }
        if (stepType === "tool_call" && Array.isArray(su.tool_calls)) {
          for (const tc of su.tool_calls) {
            if (tc && typeof tc === "object") {
              const callObj = tc as Record<string, unknown>;
              const toolName = String(callObj.name ?? callObj.tool_name ?? "agy_tool");
              const rawArgs =
                callObj.arguments && typeof callObj.arguments === "object"
                  ? (callObj.arguments as Record<string, unknown>)
                  : {};
              emit({ type: "tool_call", toolName, args: rawArgs });
            }
          }
        }
        if (stepType === "tool_result" && su.tool_result !== undefined) {
          toolStepCounter += 1;
          const guarded = sanitizeAndSpillOutput({
            runId: input.runId,
            stepKey: `agy_tool_${toolStepCounter}`,
            rawText:
              typeof su.tool_result === "string" ? su.tool_result : JSON.stringify(su.tool_result),
            artifactsDir: input.artifactsDir,
          });
          emit({
            type: "tool_result",
            toolName: String(su.tool_name ?? "agy_tool"),
            success: su.error === undefined,
            outputPreview: guarded.preview,
            artifactPath: guarded.artifactPath,
            truncated: guarded.truncated,
          });
        }
        return;
      }

      if (eventKind === "result" && parsed.result && typeof parsed.result === "object") {
        const resObj = parsed.result as Record<string, unknown>;
        if (typeof resObj.conversation_id === "string") {
          emit({ type: "session_id", sessionId: resObj.conversation_id, provider: "agy" });
        }

        if (resObj.usage && typeof resObj.usage === "object") {
          const u = resObj.usage as Record<string, unknown>;
          const inTok = Number(u.input_tokens ?? 0);
          const outTok = Number(u.output_tokens ?? 0);
          const estCost = Number(((inTok * 0.0000015) + (outTok * 0.000006)).toFixed(6));
          usageEmitted = true;
          emit({
            type: "usage",
            inputTokens: inTok,
            outputTokens: outTok,
            costUsd: estCost,
            mode: input.mode,
          });
        }

        const status = String(resObj.status ?? "");
        if (status === "ERROR" || resObj.error) {
          const errMsg = String(resObj.error ?? "AGY execution error");
          errorEmitted = true;
          emit({
            type: "error",
            errorCode: classifyCliError(errMsg),
            message: errMsg,
            recoverable: false,
          });
        } else {
          const finalResp =
            typeof resObj.response === "string" && resObj.response.length > 0
              ? resObj.response
              : accumulatedText;
          doneEmitted = true;
          emit({ type: "done", finalOutput: finalResp });
        }
      }
    });

    // Pass full prompt via UTF-8 stdin NDJSON message
    const payload = JSON.stringify({
      event: "user",
      message: {
        role: "user",
        content: input.assembled.composedPrompt,
      },
    });
    child.stdin.write(`${payload}\n`, "utf8");
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("error", (err) => {
        if (!aborted && !errorEmitted) {
          errorEmitted = true;
          emit({
            type: "error",
            errorCode: "CLI_CRASH",
            message: `Failed to launch agy: ${err.message}`,
            recoverable: false,
          });
        }
        resolve(1);
      });
      child.on("close", (code) => resolve(code));
    });

    signal.removeEventListener("abort", onAbort);
    rl.close();

    if (aborted) {
      return;
    }

    if (exitCode !== 0 && !errorEmitted) {
      const stderrText = stderrChunks.join("").trim();
      emit({
        type: "error",
        errorCode: classifyCliError(stderrText || `Exit code ${exitCode}`),
        message: stderrText || `agy exited with code ${exitCode}`,
        recoverable: false,
      });
      return;
    }

    if (!usageEmitted && accumulatedText) {
      emit({ type: "usage", inputTokens: 0, outputTokens: 0, costUsd: 0, mode: input.mode });
    }
    if (!doneEmitted && !errorEmitted) {
      emit({ type: "done", finalOutput: accumulatedText });
    }
  }
}
