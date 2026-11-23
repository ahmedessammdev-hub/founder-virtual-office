import { redactSecrets, type RuntimeProvider } from "@virtual-office/shared";
import type { PolicyGuard } from "../governance/policy-guard.js";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

/**
 * Simulates full context assembly, policy checks, command construction, and token/cost estimation
 * without spawning external processes or producing side effects.
 */
export class DryRunAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider;

  constructor(
    provider: RuntimeProvider,
    private readonly policyGuard: PolicyGuard,
  ) {
    this.provider = provider;
  }

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
  ): Promise<void> {
    emit({
      type: "status",
      status: "dry_run",
      detail: "محاكاة بدون تنفيذ فعلي (Dry-Run Mode) — فحص السياق والصلاحيات والتكلفة التقديرية.",
    });

    const toolChecks = input.employee.permissions.allowedTools.slice(0, 6).map((tool) => {
      const decision = this.policyGuard.evaluate({
        employeeId: input.employee.profile.id,
        toolName: tool,
        projectId: input.project?.id ?? null,
      });
      return `- ${tool}: ${decision.outcome} (${decision.reason})`;
    });

    const estIn = input.assembled.stats.estimatedTokens;
    const estOut = Math.max(250, Math.round(estIn * 0.25));
    const estCostUsd = Number(((estIn * 0.000003) + (estOut * 0.000015)).toFixed(4));

    const plannedCmd = this.describePlannedExecution(input);
    const preview = redactSecrets(
      [
        `### Dry-Run Plan (${input.employee.profile.nameAr} / ${input.employee.profile.name})`,
        `- **Runtime / Model:** \`${input.provider}\` / \`${input.model}\``,
        `- **Risk Tier:** \`${input.riskTier}\``,
        `- **Working Dir:** \`${input.workingDir}\``,
        `- **Planned Execution:** \`${plannedCmd}\``,
        `- **Estimated Prompt Tokens:** ~${estIn} (Memories injected: ${input.assembled.injectedMemoryIds.length})`,
        `- **Estimated Cost Range:** ~$${estCostUsd.toFixed(4)} (Zero live spend in Dry-Run)`,
        "",
        "**Tool Policy Pre-Check:**",
        ...toolChecks,
      ].join("\n"),
    );

    emit({ type: "text_delta", text: preview });
    emit({
      type: "usage",
      inputTokens: estIn,
      outputTokens: estOut,
      costUsd: estCostUsd,
      mode: "dry_run",
    });
    emit({ type: "done", finalOutput: preview });
  }

  private describePlannedExecution(input: AdapterExecuteInput): string {
    if (input.provider === "agy") {
      const mode = input.riskTier === "tier2_guarded" ? "accept-edits" : "plan";
      return `agy --output-format stream-json --input-format stream-json --model ${input.model} --sandbox --mode ${mode} --print= <stdin>`;
    }
    if (input.provider === "codex") {
      const sandbox = input.riskTier === "tier2_guarded" ? "workspace-write" : "read-only";
      const gitFlag = input.project?.isGitRepo
        ? input.riskTier === "tier2_guarded"
          ? "--worktree"
          : ""
        : "--skip-git-repo-check";
      return `codex exec --json -m ${input.model} -s ${sandbox} ${gitFlag} - <stdin>`.replace(/\s+/g, " ");
    }
    if (input.provider === "claude") {
      const mode = input.riskTier === "tier2_guarded" ? "acceptEdits" : "plan";
      return `claude -p --output-format stream-json --verbose --model ${input.model} --permission-mode ${mode} <stdin>`;
    }
    if (input.provider === "ollama") {
      return `POST http://127.0.0.1:11434/api/chat (model=${input.model})`;
    }
    if (input.provider.endsWith("_api")) {
      return `HTTPS Direct API -> ${input.provider} (model=${input.model})`;
    }
    return `${input.provider} (${input.model})`;
  }
}
