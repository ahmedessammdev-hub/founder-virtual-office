import { execFile, spawn } from "node:child_process";
import readline from "node:readline";
import type { RuntimeProvider } from "@virtual-office/shared";
import { sanitizeAndSpillOutput } from "../governance/output-guard.js";
import { classifyCliError } from "./agy-cli-adapter.js";
import { buildSafeChildEnv, resolveExecutable } from "./env-builder.js";
import { killProcessTree } from "./process-killer.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

function getGitDiffStat(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["diff", "--stat"], { cwd, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const trimmed = stdout.trim();
      resolve(trimmed || null);
    });
  });
}

export class CodexCliAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider = "codex";

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    const exe = resolveExecutable("codex");
    if (!exe) {
      emit({
        type: "error",
        errorCode: "CLI_CRASH",
        message: "codex CLI binary not found in PATH.",
        recoverable: false,
      });
      return;
    }

    const isResume =
      Boolean(input.conversation.externalSessionId) &&
      input.conversation.runtimeProvider === "codex";
    const isGitRepo = Boolean(input.project?.isGitRepo);
    const sandboxMode = input.riskTier === "tier2_guarded" ? "workspace-write" : "read-only";

    const args: string[] = isResume
      ? [
          "exec",
          "resume",
          "--json",
          "-m",
          input.model,
          ...(isGitRepo ? [] : ["--skip-git-repo-check"]),
          input.conversation.externalSessionId!,
          "-",
        ]
      : [
          "exec",
          "--json",
          "-m",
          input.model,
          "-C",
          input.workingDir,
          "-s",
          sandboxMode,
          ...(isGitRepo && input.riskTier === "tier2_guarded"
            ? ["--worktree"]
            : isGitRepo
              ? []
              : ["--skip-git-repo-check"]),
          "-",
        ];

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
    let doneEmitted = false;
    let errorEmitted = false;
    let toolCounter = 0;

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
        emit({ type: "warning", message: `codex non-JSON stdout: ${line.slice(0, 200)}` });
        return;
      }

      const eventType = typeof parsed.type === "string" ? parsed.type : "";
      if (eventType === "thread.started" && typeof parsed.thread_id === "string") {
        emit({ type: "session_id", sessionId: parsed.thread_id, provider: "codex" });
        emit({ type: "status", status: "running", detail: `Codex (${input.model})` });
        return;
      }

      if (eventType === "turn.started") {
        emit({ type: "status", status: "thinking", detail: "Processing turn..." });
        return;
      }

      if (eventType === "item.completed" && parsed.item && typeof parsed.item === "object") {
        const item = parsed.item as Record<string, unknown>;
        const itemType = String(item.type ?? "");

        if (itemType === "agent_message" && typeof item.text === "string") {
          accumulatedText += (accumulatedText ? "\n" : "") + item.text;
          emit({ type: "text_delta", text: item.text });
        } else if (itemType === "reasoning" && typeof item.text === "string") {
          emit({ type: "thinking", text: item.text });
        } else if (itemType === "command_execution" || itemType === "mcp_tool_call") {
          toolCounter += 1;
          const toolName = String(item.tool ?? item.command ?? itemType);
          emit({
            type: "tool_call",
            toolName,
            args: item.arguments && typeof item.arguments === "object"
              ? (item.arguments as Record<string, unknown>)
              : { command: item.command ?? "" },
          });
          const rawOut = String(item.aggregated_output ?? item.output ?? item.status ?? "");
          const guarded = sanitizeAndSpillOutput({
            runId: input.runId,
            stepKey: `codex_tool_${toolCounter}`,
            rawText: rawOut,
            artifactsDir: input.artifactsDir,
          });
          emit({
            type: "tool_result",
            toolName,
            success: item.exit_code === undefined || Number(item.exit_code) === 0,
            outputPreview: guarded.preview,
            artifactPath: guarded.artifactPath,
            truncated: guarded.truncated,
          });
        } else if (itemType === "file_change") {
          emit({
            type: "tool_call",
            toolName: "write_file_worktree",
            args: { changes: item.changes ?? [] },
            riskTier: "tier2_guarded",
          });
        } else if (itemType === "error" && typeof item.message === "string") {
          emit({ type: "warning", message: item.message });
        }
        return;
      }

      if (eventType === "turn.completed") {
        if (parsed.usage && typeof parsed.usage === "object") {
          const u = parsed.usage as Record<string, unknown>;
          const inTok = Number(u.input_tokens ?? 0);
          const outTok = Number(u.output_tokens ?? 0);
          const estCost = Number(((inTok * 0.000002) + (outTok * 0.000008)).toFixed(6));
          emit({
            type: "usage",
            inputTokens: inTok,
            outputTokens: outTok,
            costUsd: estCost,
            mode: input.mode,
          });
        }
        doneEmitted = true;
        emit({ type: "done", finalOutput: accumulatedText });
        return;
      }

      if (eventType === "turn.failed" || eventType === "error") {
        const errObj =
          parsed.error && typeof parsed.error === "object"
            ? (parsed.error as Record<string, unknown>)
            : parsed;
        const msg = String(errObj.message ?? "Codex turn failed");
        errorEmitted = true;
        emit({
          type: "error",
          errorCode: classifyCliError(msg),
          message: msg,
          recoverable: false,
        });
      }
    });

    // Write UTF-8 prompt to stdin and close
    child.stdin.write(input.assembled.composedPrompt, "utf8");
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("error", (err) => {
        if (!aborted && !errorEmitted) {
          errorEmitted = true;
          emit({
            type: "error",
            errorCode: "CLI_CRASH",
            message: `Failed to launch codex: ${err.message}`,
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

    if (isGitRepo && input.riskTier === "tier2_guarded") {
      const diffStat = await getGitDiffStat(input.workingDir);
      if (diffStat) {
        emit({ type: "status", status: "git_diff_stat", detail: diffStat });
      }
    }

    if (exitCode !== 0 && !errorEmitted) {
      const stderrText = stderrChunks.join("").trim();
      emit({
        type: "error",
        errorCode: classifyCliError(stderrText || `Exit code ${exitCode}`),
        message: stderrText || `codex exited with code ${exitCode}`,
        recoverable: false,
      });
      return;
    }

    if (!doneEmitted && !errorEmitted) {
      emit({ type: "done", finalOutput: accumulatedText });
    }
  }
}
