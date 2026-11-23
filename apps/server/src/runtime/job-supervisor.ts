import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  redactSecrets,
  type CreateRunInput,
  type NormalizedAgentEvent,
  type RiskTier,
  type Run,
  type RunErrorCode,
  type RunMode,
  type RuntimeProvider,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { ConversationsRepository } from "../db/repositories/conversations-repo.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { RunsRepository, StoredRunEvent } from "../db/repositories/runs-repo.js";
import type { UsageRepository } from "../db/repositories/usage-repo.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { ApprovalEngine } from "../governance/approval-engine.js";
import type { LocalAuthManager } from "../governance/auth.js";
import type { BudgetGovernor } from "../governance/budget-governor.js";
import type { PolicyGuard } from "../governance/policy-guard.js";
import type { CredentialVault } from "../governance/vault.js";
import type { McpManager } from "../mcp/mcp-manager.js";
import { updateRollingSummaryIfNeeded, type MemoryManager } from "../memory/index.js";
import { AgyCliAdapter } from "./agy-cli-adapter.js";
import { ClaudeCliAdapter } from "./claude-cli-adapter.js";
import { CodexCliAdapter } from "./codex-cli-adapter.js";
import { assembleContext } from "./context-assembler.js";
import { DirectApiAdapter, type DirectApiProvider } from "./direct-api-adapter.js";
import { DryRunAdapter } from "./dry-run-adapter.js";
import { MockAdapter } from "./mock-adapter.js";
import { OllamaAdapter } from "./ollama-adapter.js";
import type { AdapterExecuteInput, RuntimeAdapter } from "./types.js";

export interface RunBusEvent {
  runId: string;
  storedEvent: StoredRunEvent;
}

export interface SupervisorOptions {
  artifactsDir: string;
  defaultTimeoutMs?: number;
  deltaFlushIntervalMs?: number;
  maxConcurrentRuns?: number;
  tasksRepo?: TasksRepository;
  vault?: CredentialVault;
  mcpManager?: McpManager;
  memoryManager?: MemoryManager;
  auth?: LocalAuthManager;
  officeMcpUrlRef?: { url: string };
  directApiBaseUrls?: Partial<Record<DirectApiProvider, string>>;
  ollamaBaseUrl?: string;
}

const PAID_DIRECT_API_PROVIDERS = new Set<RuntimeProvider>([
  "gemini_api",
  "openai_api",
  "anthropic_api",
  "openrouter_api",
]);

interface QueuedJob {
  run: Run;
  input: CreateRunInput;
  timeoutMs: number;
}

interface ActiveRunControl {
  controller: AbortController;
  abortReason: "CANCELLED" | "TIMED_OUT" | "BUDGET_EXCEEDED" | "LOOP_DETECTED" | "POLICY_DENIED" | "WAITING_APPROVAL" | null;
  errorDetail?: string;
}

/**
 * Coordinates concurrency limits, per-conversation mutexes, non-Git workspace write locks,
 * loop circuit-breaking, mid-flight budget kills, timeouts, delta coalescing, and crash recovery.
 */
export class JobSupervisor {
  public readonly bus = new EventEmitter();
  private readonly queue: QueuedJob[] = [];
  private readonly activeRuns = new Map<string, ActiveRunControl>();
  private readonly activeConversations = new Set<string>();
  private readonly activeNonGitWriteProjects = new Set<string>();
  private readonly adapters: Map<RuntimeProvider, RuntimeAdapter>;
  private readonly artifactsDir: string;
  private readonly defaultTimeoutMs: number;
  private readonly deltaFlushIntervalMs: number;
  private readonly maxConcurrentOverride?: number;
  private readonly auth?: LocalAuthManager;
  private readonly officeMcpUrlRef?: { url: string };
  private readonly memoryManager?: MemoryManager;
  private pumpScheduled = false;

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly runsRepo: RunsRepository,
    private readonly conversationsRepo: ConversationsRepository,
    private readonly memoryRepo: MemoryRepository,
    private readonly usageRepo: UsageRepository,
    private readonly auditRepo: AuditRepository,
    private readonly policyGuard: PolicyGuard,
    private readonly approvalEngine: ApprovalEngine,
    private readonly budgetGovernor: BudgetGovernor,
    options: SupervisorOptions,
  ) {
    this.artifactsDir = options.artifactsDir;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
    this.deltaFlushIntervalMs = options.deltaFlushIntervalMs ?? 2_000;
    this.maxConcurrentOverride = options.maxConcurrentRuns;
    this.auth = options.auth;
    this.officeMcpUrlRef = options.officeMcpUrlRef;
    this.memoryManager = options.memoryManager;

    this.adapters = new Map<RuntimeProvider, RuntimeAdapter>([
      ["mock", new MockAdapter(companyStore.companyRoot)],
      ["agy", new AgyCliAdapter()],
      ["codex", new CodexCliAdapter()],
      ["claude", new ClaudeCliAdapter()],
    ]);

    if (options.tasksRepo && options.vault && options.mcpManager) {
      const apiDeps = {
        companyStore,
        memoryRepo,
        tasksRepo: options.tasksRepo,
        vault: options.vault,
        policyGuard,
        mcpManager: options.mcpManager,
        baseUrls: options.directApiBaseUrls,
      };
      this.adapters.set("gemini_api", new DirectApiAdapter("gemini_api", apiDeps));
      this.adapters.set("openai_api", new DirectApiAdapter("openai_api", apiDeps));
      this.adapters.set("anthropic_api", new DirectApiAdapter("anthropic_api", apiDeps));
      this.adapters.set("openrouter_api", new DirectApiAdapter("openrouter_api", apiDeps));
      this.adapters.set(
        "ollama",
        new OllamaAdapter({
          baseUrl: options.ollamaBaseUrl,
          companyStore,
          memoryRepo,
          tasksRepo: options.tasksRepo,
          vault: options.vault,
          policyGuard,
        }),
      );
    }

    // Recover runs left RUNNING during any previous unexpected crash
    this.runsRepo.recoverInterruptedRuns();
  }

  public enqueueRun(rawInput: CreateRunInput, customTimeoutMs?: number): Run {
    const employee = this.companyStore.getEmployee(rawInput.employeeId);
    if (!employee) {
      throw new Error(`Employee "${rawInput.employeeId}" does not exist.`);
    }

    if (rawInput.projectId) {
      const project = this.companyStore.getProject(rawInput.projectId);
      if (!project) {
        throw new Error(`Project "${rawInput.projectId}" does not exist.`);
      }
      if (
        employee.permissions.allowedProjectIds !== "*" &&
        !employee.permissions.allowedProjectIds.includes(rawInput.projectId)
      ) {
        throw new Error(`Employee "${rawInput.employeeId}" is not allowed on project "${rawInput.projectId}".`);
      }
    }

    let conversation = rawInput.conversationId
      ? this.conversationsRepo.getById(rawInput.conversationId)
      : null;

    if (!conversation) {
      conversation = this.conversationsRepo.create({
        id: rawInput.conversationId,
        employeeId: employee.profile.id,
        projectId: rawInput.projectId ?? null,
        title: rawInput.prompt.slice(0, 80),
        runtimeProvider: rawInput.providerOverride ?? employee.profile.runtime.provider,
      });
    }

    const mode: RunMode = rawInput.mode ?? "live";
    const provider: RuntimeProvider =
      mode === "mock"
        ? "mock"
        : (rawInput.providerOverride ?? employee.profile.runtime.provider);
    const model =
      mode === "mock"
        ? "mock-deterministic-v1"
        : (rawInput.modelOverride ?? employee.profile.runtime.model);
    const riskTier: RiskTier = rawInput.riskTier ?? "tier1_auto";

    // Pre-flight budget check for live runs
    const budgetCheck = this.budgetGovernor.preFlightCheck({
      mode,
      employeeId: employee.profile.id,
      projectId: rawInput.projectId,
      provider,
    });

    if (!budgetCheck.allowed) {
      const rejectedRun = this.runsRepo.create({
        conversationId: conversation.id,
        employeeId: employee.profile.id,
        projectId: rawInput.projectId ?? null,
        taskId: rawInput.taskId ?? null,
        mode,
        status: "BUDGET_EXCEEDED",
        runtimeProvider: provider,
        model,
        riskTier,
        prompt: rawInput.prompt,
        configSnapshot: {
          employeeProfile: employee.profile,
          permissionsAtStart: employee.permissions,
        },
      });
      this.runsRepo.updateStatus(rejectedRun.id, "BUDGET_EXCEEDED", {
        errorCode: "BUDGET_EXCEEDED",
        errorMessage: budgetCheck.reason,
        finished: true,
      });
      this.auditRepo.log({
        actorType: "system",
        actorId: "budget-governor",
        action: "run.preflight_blocked",
        targetType: "run",
        targetId: rejectedRun.id,
        status: "BUDGET_EXCEEDED",
        details: { reason: budgetCheck.reason },
      });
      return this.runsRepo.getById(rejectedRun.id) ?? rejectedRun;
    }

    // Record user turn into conversation history
    this.conversationsRepo.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: rawInput.prompt,
    });

    const run = this.runsRepo.create({
      conversationId: conversation.id,
      employeeId: employee.profile.id,
      projectId: rawInput.projectId ?? null,
      taskId: rawInput.taskId ?? null,
      mode,
      status: "QUEUED",
      runtimeProvider: provider,
      model,
      riskTier,
      prompt: rawInput.prompt,
      configSnapshot: {
        employeeProfile: employee.profile,
        permissionsAtStart: employee.permissions,
        companyBudgets: this.companyStore.getCompanyConfig().budgets,
      },
    });

    this.queue.push({
      run,
      input: rawInput,
      timeoutMs:
        customTimeoutMs ??
        this.companyStore.getCompanyConfig().budgets.defaultRunTimeoutMs ??
        this.defaultTimeoutMs,
    });
    this.emitRunStatus(run.id);
    this.schedulePump();
    return run;
  }

  public cancelRun(runId: string): boolean {
    const queuedIdx = this.queue.findIndex((q) => q.run.id === runId);
    if (queuedIdx !== -1) {
      const [removed] = this.queue.splice(queuedIdx, 1);
      if (removed) {
        this.runsRepo.updateStatus(runId, "CANCELLED", {
          errorCode: "CANCELLED",
          errorMessage: "Run cancelled while queued.",
          finished: true,
        });
        this.persistAndBroadcastEvent(runId, 1, {
          type: "error",
          errorCode: "CANCELLED",
          message: "Run cancelled while queued.",
          recoverable: false,
        });
        this.emitRunStatus(runId);
        return true;
      }
    }

    const active = this.activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.abortReason = "CANCELLED";
    active.errorDetail = "Cancelled by user.";
    active.controller.abort();
    return true;
  }

  public async shutdown(): Promise<void> {
    this.queue.length = 0;
    for (const [, active] of this.activeRuns) {
      active.abortReason = "CANCELLED";
      active.errorDetail = "Server shutting down.";
      active.controller.abort();
    }
    // Brief drain wait so child trees receive taskkill
    const start = Date.now();
    while (this.activeRuns.size > 0 && Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  public getActiveCount(): number {
    return this.activeRuns.size;
  }

  public getQueuedCount(): number {
    return this.queue.length;
  }

  private schedulePump(): void {
    if (this.pumpScheduled) {
      return;
    }
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pumpQueue();
    });
  }

  private pumpQueue(): void {
    const maxConcurrent =
      this.maxConcurrentOverride ??
      this.companyStore.getCompanyConfig().budgets.maxConcurrentRuns;

    let idx = 0;
    while (idx < this.queue.length && this.activeRuns.size < maxConcurrent) {
      const job = this.queue[idx]!;
      if (this.canStartJob(job)) {
        this.queue.splice(idx, 1);
        void this.executeJob(job);
      } else {
        idx += 1;
      }
    }
  }

  private canStartJob(job: QueuedJob): boolean {
    if (this.activeConversations.has(job.run.conversationId)) {
      return false;
    }

    if (job.run.projectId && job.run.riskTier === "tier2_guarded") {
      const project = this.companyStore.getProject(job.run.projectId);
      if (project && !project.isGitRepo && this.activeNonGitWriteProjects.has(project.id)) {
        return false;
      }
    }

    return true;
  }

  private async executeJob(job: QueuedJob): Promise<void> {
    const { run, input, timeoutMs } = job;
    const employee = this.companyStore.getEmployee(run.employeeId);
    if (!employee) {
      this.runsRepo.updateStatus(run.id, "FAILED", {
        errorCode: "INTERNAL_ERROR",
        errorMessage: `Employee "${run.employeeId}" missing when starting run.`,
        finished: true,
      });
      return;
    }

    const project = run.projectId ? this.companyStore.getProject(run.projectId) : null;
    const isNonGitWrite = Boolean(project && !project.isGitRepo && run.riskTier === "tier2_guarded");

    this.activeConversations.add(run.conversationId);
    if (isNonGitWrite && project) {
      this.activeNonGitWriteProjects.add(project.id);
    }

    const control: ActiveRunControl = {
      controller: new AbortController(),
      abortReason: null,
    };
    this.activeRuns.set(run.id, control);

    const timeoutTimer = setTimeout(() => {
      if (!control.abortReason) {
        control.abortReason = "TIMED_OUT";
        control.errorDetail = `Run exceeded wall-clock timeout (${timeoutMs}ms).`;
        control.controller.abort();
      }
    }, timeoutMs);

    let runSeq = 0;
    let deltaBuffer = "";
    let deltaTimer: ReturnType<typeof setInterval> | null = null;
    let totalCostUsd = 0;
    let stepCount = 0;
    let lastToolSignature = "";
    let identicalToolRepeats = 0;
    let consecutiveToolErrors = 0;
    let fullOutput = "";
    let terminalHandled = false;

    const flushDeltaBuffer = (): void => {
      if (!deltaBuffer) {
        return;
      }
      const chunk = deltaBuffer;
      deltaBuffer = "";
      runSeq += 1;
      const stored = this.runsRepo.appendRunEvent(run.id, runSeq, {
        type: "text_delta",
        text: chunk,
      });
      this.bus.emit("run_event", { runId: run.id, storedEvent: stored } satisfies RunBusEvent);
    };

    deltaTimer = setInterval(flushDeltaBuffer, this.deltaFlushIntervalMs);

    try {
      this.runsRepo.markStarted(run.id, "RUNNING");
      this.emitRunStatus(run.id);

      const conversation = this.conversationsRepo.getById(run.conversationId)!;
      const recentMessages = this.conversationsRepo.listMessages(run.conversationId, 20);
      const retrievedMemories = this.memoryManager
        ? (
            await this.memoryManager.search({
              q: input.prompt,
              forEmployeeId: employee.profile.id,
              forProjectId: project?.id ?? null,
              limit: 8,
            })
          ).entries
        : this.memoryRepo.search({
            q: input.prompt,
            forEmployeeId: employee.profile.id,
            forProjectId: project?.id ?? null,
            limit: 8,
          });

      const assembled = assembleContext({
        company: this.companyStore.getCompanyConfig(),
        employee,
        project,
        conversation,
        recentMessages,
        retrievedMemories,
        userPrompt: input.prompt,
        externalInputs: input.externalInputs,
      });

      this.memoryRepo.touchAccessed(assembled.injectedMemoryIds);

      const contextEvent: NormalizedAgentEvent = {
        type: "context_assembled",
        tokenEstimate: assembled.stats.estimatedTokens,
        injectedMemoryIds: assembled.injectedMemoryIds,
        hasUntrustedExternalInput: assembled.hasUntrustedExternalInput,
        slices: assembled.stats.slices,
      };
      runSeq += 1;
      this.persistAndBroadcastEvent(run.id, runSeq, contextEvent);

      const workingDir = project?.rootPath ?? employee.rootDir;
      const officeRunToken = this.auth
        ? this.auth.mintRunToken({
            runId: run.id,
            employeeId: run.employeeId,
            projectId: run.projectId ?? null,
          })
        : undefined;
      const adapterInput: AdapterExecuteInput = {
        runId: run.id,
        mode: run.mode,
        provider: run.runtimeProvider,
        model: run.model,
        effort: employee.profile.runtime.effort,
        riskTier: run.riskTier,
        company: this.companyStore.getCompanyConfig(),
        employee,
        project,
        conversation,
        recentMessages,
        retrievedMemories,
        rawUserPrompt: input.prompt,
        assembled,
        mockScenario: input.mockScenario,
        artifactsDir: this.artifactsDir,
        workingDir,
        officeMcpUrl: this.officeMcpUrlRef?.url,
        officeRunToken,
      };

      const adapter = this.resolveAdapter(run.mode, run.runtimeProvider);
      if (!adapter) {
        const msg = `Runtime adapter "${run.runtimeProvider}" is not initialized.`;
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: "INTERNAL_ERROR",
          message: msg,
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "FAILED", {
          errorCode: "INTERNAL_ERROR",
          errorMessage: msg,
          finished: true,
        });
        return;
      }

      let fallbackAttempted = false;
      let pendingFallback: {
        provider: RuntimeProvider;
        model: string;
        triggerCode: RunErrorCode;
        triggerMessage: string;
      } | null = null;

      const handleEvent = (event: NormalizedAgentEvent): void => {
        if (control.abortReason) {
          return;
        }

        if (event.type === "text_delta") {
          fullOutput += event.text;
          deltaBuffer += event.text;
          // Broadcast live delta immediately over WebSocket while coalescing DB writes
          const liveEvent: StoredRunEvent = {
            seq: 0,
            runId: run.id,
            runSeq,
            eventType: "text_delta",
            event,
            createdAt: new Date().toISOString(),
          };
          this.bus.emit("run_live_delta", { runId: run.id, storedEvent: liveEvent });
          return;
        }

        // Flush any buffered deltas before persisting structural events to preserve chronological order
        flushDeltaBuffer();

        if (event.type === "session_id") {
          this.conversationsRepo.updateExternalSession(
            run.conversationId,
            event.sessionId,
            event.provider,
          );
        }

        if (event.type === "tool_call") {
          // Live Policy Check using CURRENT permissions from CompanyStore (enforces immediate revocation!)
          const livePolicy = this.policyGuard.evaluate({
            employeeId: run.employeeId,
            toolName: event.toolName,
            requestedRiskTier: event.riskTier,
            projectId: run.projectId,
            targetPath:
              typeof event.args.path === "string"
                ? path.resolve(workingDir, event.args.path)
                : undefined,
          });

          if (livePolicy.outcome === "deny") {
            control.abortReason = "POLICY_DENIED";
            control.errorDetail = livePolicy.reason;
            runSeq += 1;
            this.persistAndBroadcastEvent(run.id, runSeq, {
              type: "error",
              errorCode: "SANDBOX_DENIED",
              message: livePolicy.reason,
              recoverable: false,
            });
            control.controller.abort();
            return;
          }

          if (livePolicy.outcome === "require_approval") {
            const approval = this.approvalEngine.createApproval({
              runId: run.id,
              taskId: run.taskId,
              employeeId: run.employeeId,
              projectId: run.projectId,
              actionType: event.toolName,
              riskTier: "tier3_approval",
              title: `موافقة مطلوبة: ${event.toolName}`,
              summary: livePolicy.reason,
              payload: event.args,
              taintedByExternalInput: assembled.hasUntrustedExternalInput,
            });
            runSeq += 1;
            this.persistAndBroadcastEvent(run.id, runSeq, {
              type: "approval_requested",
              actionType: event.toolName,
              riskTier: "tier3_approval",
              title: approval.title,
              summary: approval.summary,
              payload: { ...event.args, approvalId: approval.id },
            });
            control.abortReason = "WAITING_APPROVAL";
            control.errorDetail = approval.id;
            control.controller.abort();
            return;
          }

          // Enforce max steps & repetition circuit breaker
          const livePerms = this.companyStore.getEmployee(run.employeeId)?.permissions ?? employee.permissions;
          stepCount += 1;
          if (stepCount > livePerms.maxStepsPerRun) {
            control.abortReason = "LOOP_DETECTED";
            control.errorDetail = `Max steps per run (${livePerms.maxStepsPerRun}) exceeded.`;
            runSeq += 1;
            this.persistAndBroadcastEvent(run.id, runSeq, {
              type: "error",
              errorCode: "LOOP_DETECTED",
              message: control.errorDetail,
              recoverable: false,
            });
            control.controller.abort();
            return;
          }

          const sig = `${event.toolName}:${crypto.createHash("sha1").update(JSON.stringify(event.args)).digest("hex")}`;
          if (sig === lastToolSignature) {
            identicalToolRepeats += 1;
          } else {
            lastToolSignature = sig;
            identicalToolRepeats = 1;
          }

          if (identicalToolRepeats >= 3) {
            control.abortReason = "LOOP_DETECTED";
            control.errorDetail = `Circuit breaker triggered: tool "${event.toolName}" repeated ${identicalToolRepeats} identical times.`;
            runSeq += 1;
            this.persistAndBroadcastEvent(run.id, runSeq, {
              type: "error",
              errorCode: "LOOP_DETECTED",
              message: control.errorDetail,
              recoverable: false,
            });
            control.controller.abort();
            return;
          }
        }

        if (event.type === "tool_result") {
          if (!event.success) {
            consecutiveToolErrors += 1;
            if (consecutiveToolErrors >= 3) {
              runSeq += 1;
              this.persistAndBroadcastEvent(run.id, runSeq, event);
              control.abortReason = "LOOP_DETECTED";
              control.errorDetail = `Circuit breaker triggered after 3 consecutive failing tool calls (${event.toolName}).`;
              runSeq += 1;
              this.persistAndBroadcastEvent(run.id, runSeq, {
                type: "error",
                errorCode: "LOOP_DETECTED",
                message: control.errorDetail,
                recoverable: false,
              });
              control.controller.abort();
              return;
            }
          } else {
            consecutiveToolErrors = 0;
          }
        }

        if (event.type === "approval_requested") {
          const approval = this.approvalEngine.createApproval({
            runId: run.id,
            taskId: run.taskId,
            employeeId: run.employeeId,
            projectId: run.projectId,
            actionType: event.actionType,
            riskTier: event.riskTier,
            title: event.title,
            summary: event.summary,
            payload: event.payload,
            diffPreview: event.diffPreview,
            taintedByExternalInput: assembled.hasUntrustedExternalInput,
          });
          runSeq += 1;
          this.persistAndBroadcastEvent(run.id, runSeq, {
            ...event,
            payload: { ...event.payload, approvalId: approval.id },
          });
          control.abortReason = "WAITING_APPROVAL";
          control.errorDetail = approval.id;
          control.controller.abort();
          return;
        }

        if (event.type === "usage") {
          const usageMode = event.mode ?? run.mode;
          totalCostUsd += event.costUsd;
          this.runsRepo.addUsage(run.id, event.inputTokens, event.outputTokens, event.costUsd);
          this.usageRepo.record({
            runId: run.id,
            employeeId: run.employeeId,
            projectId: run.projectId ?? null,
            provider: run.runtimeProvider,
            model: run.model,
            mode: usageMode,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costUsd: event.costUsd,
          });

          const midFlight = this.budgetGovernor.checkMidFlight({
            mode: run.mode,
            runCostUsd: totalCostUsd,
            taskBudgetUsd: employee.permissions.taskBudgetUsd,
            employeeId: run.employeeId,
            projectId: run.projectId,
            provider: run.runtimeProvider,
          });
          runSeq += 1;
          this.persistAndBroadcastEvent(run.id, runSeq, event);

          if (!midFlight.allowed) {
            control.abortReason = "BUDGET_EXCEEDED";
            control.errorDetail = midFlight.reason;
            runSeq += 1;
            this.persistAndBroadcastEvent(run.id, runSeq, {
              type: "error",
              errorCode: "BUDGET_EXCEEDED",
              message: midFlight.reason ?? "Budget exceeded.",
              recoverable: false,
            });
            control.controller.abort();
            return;
          }
          return;
        }

        if (event.type === "status" && event.status === "git_diff_stat" && event.detail) {
          this.runsRepo.updateStatus(run.id, "RUNNING", { diffStat: event.detail });
        }

        if (event.type === "error") {
          const isTransient =
            event.errorCode === "RATE_LIMITED" || event.errorCode === "QUOTA_EXCEEDED";
          const fbProvider = employee.profile.runtime.fallbackProvider;
          const fbModel = employee.profile.runtime.fallbackModel;

          if (
            isTransient &&
            run.mode === "live" &&
            !fallbackAttempted &&
            fbProvider &&
            fbModel &&
            fbProvider !== run.runtimeProvider
          ) {
            const companyPolicy = this.companyStore.getCompanyConfig();
            const isPaidFallback = PAID_DIRECT_API_PROVIDERS.has(fbProvider);
            if (isPaidFallback && !companyPolicy.budgets.allowPaidFallback) {
              runSeq += 1;
              this.persistAndBroadcastEvent(run.id, runSeq, {
                type: "warning",
                message: `Transient ${event.errorCode} encountered, but paid fallback to "${fbProvider}" is blocked (allowPaidFallback=false).`,
              });
            } else if (this.resolveAdapter("live", fbProvider)) {
              pendingFallback = {
                provider: fbProvider,
                model: fbModel,
                triggerCode: event.errorCode,
                triggerMessage: event.message,
              };
              return;
            }
          }

          terminalHandled = true;
          runSeq += 1;
          this.persistAndBroadcastEvent(run.id, runSeq, event);
          this.runsRepo.updateStatus(run.id, "FAILED", {
            errorCode: event.errorCode,
            errorMessage: event.message,
            finished: true,
          });
          return;
        }

        if (event.type === "done") {
          terminalHandled = true;
          const finalText = redactSecrets(event.finalOutput ?? fullOutput);
          runSeq += 1;
          this.persistAndBroadcastEvent(run.id, runSeq, { type: "done", finalOutput: finalText });
          this.runsRepo.updateStatus(run.id, "COMPLETED", {
            finalOutput: finalText,
            finished: true,
          });
          if (finalText) {
            this.conversationsRepo.appendMessage({
              conversationId: run.conversationId,
              runId: run.id,
              role: "assistant",
              content: finalText,
            });
          }
          updateRollingSummaryIfNeeded(
            this.conversationsRepo,
            run.conversationId,
            this.companyStore.getCompanyConfig().memory?.rollingSummaryEveryMessages ?? 8,
          );
          return;
        }

        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, event);
      };

      await adapter.execute(adapterInput, handleEvent, control.controller.signal);

      if (pendingFallback !== null && !control.abortReason && !terminalHandled) {
        const fb: {
          provider: RuntimeProvider;
          model: string;
          triggerCode: RunErrorCode;
          triggerMessage: string;
        } = pendingFallback;
        pendingFallback = null;
        fallbackAttempted = true;
        const fbAdapter = this.resolveAdapter("live", fb.provider);
        if (fbAdapter) {
          runSeq += 1;
          this.persistAndBroadcastEvent(run.id, runSeq, {
            type: "warning",
            message: `Transient ${fb.triggerCode} on ${adapterInput.provider}; falling back once to ${fb.provider}/${fb.model}.`,
          });
          this.auditRepo.log({
            actorType: "system",
            actorId: "job-supervisor",
            action: "run.fallback_triggered",
            targetType: "run",
            targetId: run.id,
            status: "RETRY",
            details: {
              fromProvider: adapterInput.provider,
              toProvider: fb.provider,
              toModel: fb.model,
              triggerCode: fb.triggerCode,
            },
          });
          await fbAdapter.execute(
            { ...adapterInput, provider: fb.provider, model: fb.model },
            handleEvent,
            control.controller.signal,
          );
        }
      }

      flushDeltaBuffer();

      // Reconcile terminal state when aborted or adapter returned cleanly without terminal event
      if (control.abortReason === "WAITING_APPROVAL") {
        this.runsRepo.updateStatus(run.id, "WAITING_APPROVAL", {
          finalOutput: fullOutput || null,
        });
      } else if (control.abortReason === "CANCELLED") {
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: "CANCELLED",
          message: control.errorDetail ?? "Cancelled",
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "CANCELLED", {
          errorCode: "CANCELLED",
          errorMessage: control.errorDetail ?? "Cancelled",
          finished: true,
        });
      } else if (control.abortReason === "TIMED_OUT") {
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: "TIMEOUT",
          message: control.errorDetail ?? "Timed out",
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "TIMED_OUT", {
          errorCode: "TIMEOUT",
          errorMessage: control.errorDetail ?? "Timed out",
          finished: true,
        });
      } else if (control.abortReason === "BUDGET_EXCEEDED") {
        this.runsRepo.updateStatus(run.id, "BUDGET_EXCEEDED", {
          errorCode: "BUDGET_EXCEEDED",
          errorMessage: control.errorDetail ?? "Budget exceeded",
          finished: true,
        });
      } else if (control.abortReason === "LOOP_DETECTED") {
        this.runsRepo.updateStatus(run.id, "FAILED", {
          errorCode: "LOOP_DETECTED",
          errorMessage: control.errorDetail ?? "Loop circuit breaker triggered",
          finished: true,
        });
      } else if (control.abortReason === "POLICY_DENIED") {
        this.runsRepo.updateStatus(run.id, "FAILED", {
          errorCode: "SANDBOX_DENIED",
          errorMessage: control.errorDetail ?? "Policy denied",
          finished: true,
        });
      } else if (!terminalHandled) {
        const finalText = redactSecrets(fullOutput);
        this.runsRepo.updateStatus(run.id, "COMPLETED", {
          finalOutput: finalText,
          finished: true,
        });
        if (finalText) {
          this.conversationsRepo.appendMessage({
            conversationId: run.conversationId,
            runId: run.id,
            role: "assistant",
            content: finalText,
          });
        }
        updateRollingSummaryIfNeeded(
          this.conversationsRepo,
          run.conversationId,
          this.companyStore.getCompanyConfig().memory?.rollingSummaryEveryMessages ?? 8,
        );
      }
    } catch (error) {
      flushDeltaBuffer();
      const message = error instanceof Error ? error.message : String(error);
      const isCancelled = control.abortReason === "CANCELLED";
      const isTimedOut = control.abortReason === "TIMED_OUT";
      if (isCancelled) {
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: "CANCELLED",
          message: control.errorDetail ?? "Cancelled",
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "CANCELLED", {
          errorCode: "CANCELLED",
          errorMessage: control.errorDetail ?? "Cancelled",
          finished: true,
        });
      } else if (isTimedOut) {
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: "TIMEOUT",
          message: control.errorDetail ?? "Timed out",
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "TIMED_OUT", {
          errorCode: "TIMEOUT",
          errorMessage: control.errorDetail ?? "Timed out",
          finished: true,
        });
      } else if (!terminalHandled) {
        const code: RunErrorCode = "INTERNAL_ERROR";
        runSeq += 1;
        this.persistAndBroadcastEvent(run.id, runSeq, {
          type: "error",
          errorCode: code,
          message,
          recoverable: false,
        });
        this.runsRepo.updateStatus(run.id, "FAILED", {
          errorCode: code,
          errorMessage: message,
          finished: true,
        });
      }
    } finally {
      if (deltaTimer) {
        clearInterval(deltaTimer);
      }
      clearTimeout(timeoutTimer);
      this.activeRuns.delete(run.id);
      this.activeConversations.delete(run.conversationId);
      if (isNonGitWrite && project) {
        this.activeNonGitWriteProjects.delete(project.id);
      }
      this.bus.emit("run_finished", { runId: run.id, status: this.runsRepo.getById(run.id)?.status });
      this.emitRunStatus(run.id);
      this.schedulePump();
    }
  }

  public emitRunStatus(runId: string): void {
    const run = this.runsRepo.getById(runId);
    if (run) {
      this.bus.emit("run_status", { run });
    }
  }

  private resolveAdapter(mode: RunMode, provider: RuntimeProvider): RuntimeAdapter | null {
    if (mode === "mock") {
      return this.adapters.get("mock") ?? null;
    }
    if (mode === "dry_run") {
      return new DryRunAdapter(provider, this.policyGuard);
    }
    return this.adapters.get(provider) ?? null;
  }

  private persistAndBroadcastEvent(
    runId: string,
    runSeq: number,
    event: NormalizedAgentEvent,
  ): void {
    const stored = this.runsRepo.appendRunEvent(runId, runSeq, event);
    this.bus.emit("run_event", { runId, storedEvent: stored } satisfies RunBusEvent);
  }
}
