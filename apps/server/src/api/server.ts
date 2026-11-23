import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z } from "zod";
import {
  ApprovalDecisionInputSchema,
  ApprovalStatusSchema,
  BrowserSecurityPolicySchema,
  BudgetPolicySchema,
  CreateGitSnapshotInputSchema,
  CreateHiringProposalInputSchema,
  CreateMeetingInputSchema,
  CreateMemoryNoteInputSchema,
  CreateRunInputSchema,
  CreateScheduledJobInputSchema,
  CreateTaskInputSchema,
  CreateTaskPlanInputSchema,
  HiringProposalStatusSchema,
  LearningProposalStatusSchema,
  McpServerConfigSchema,
  MemoryPolicySchema,
  MemorySearchQuerySchema,
  PromoteMemoryInputSchema,
  RegisterProjectInputSchema,
  ResolveConflictInputSchema,
  RestoreGitSnapshotInputSchema,
  RollbackProposalInputSchema,
  RunModeSchema,
  SubmitFeedbackInputSchema,
  TaskStatusSchema,
  TelegramPolicySchema,
  UpdateFloorplanLayoutInputSchema,
  UpdateScheduledJobInputSchema,
  redactSecrets,
  type ApprovalDecisionInput,
} from "@virtual-office/shared";
import { AnalyticsService } from "../analytics/index.js";
import { GitBackupManager } from "../backup/index.js";
import { CompanyStore } from "../company/company-store.js";
import { MemoryIndexer } from "../company/memory-indexer.js";
import { OfficeDatabase } from "../db/database.js";
import {
  ApprovalsRepository,
  AuditRepository,
  ConversationsRepository,
  HiringProposalsRepository,
  LearningProposalsRepository,
  MeetingsRepository,
  MemoryRepository,
  RunsRepository,
  SchedulesRepository,
  TaskPlansRepository,
  TasksRepository,
  TelegramRepository,
  UsageRepository,
  formatAuditLogsCsv,
} from "../db/repositories/index.js";
import {
  CRON_PRESETS,
  CronScheduler,
  TelegramBridge,
} from "../automation/index.js";
import {
  ApprovalEngine,
  BudgetGovernor,
  CredentialVault,
  LocalAuthManager,
  PolicyGuard,
  type ApprovalDecideResult,
  type MasterKeyProvider,
} from "../governance/index.js";
import { McpManager, OfficeMcpServer, type JsonRpcRequest } from "../mcp/index.js";
import {
  LearningEngine,
  MemoryManager,
  VectorStore,
  updateRollingSummaryIfNeeded,
  type EmbeddingProvider,
} from "../memory/index.js";
import {
  HiringEngine,
  MeetingEngine,
  OrchestratorDagEngine,
} from "../orchestration/index.js";
import {
  JobSupervisor,
  ProviderDetector,
  type DirectApiProvider,
  type RunBusEvent,
} from "../runtime/index.js";

export interface OfficeAppContext {
  app: FastifyInstance;
  db: OfficeDatabase;
  companyStore: CompanyStore;
  memoryIndexer: MemoryIndexer;
  vectorStore: VectorStore;
  memoryManager: MemoryManager;
  learningEngine: LearningEngine;
  dagEngine: OrchestratorDagEngine;
  meetingEngine: MeetingEngine;
  hiringEngine: HiringEngine;
  cronScheduler: CronScheduler;
  telegramBridge: TelegramBridge;
  analyticsService: AnalyticsService;
  gitBackup: GitBackupManager;
  auth: LocalAuthManager;
  vault: CredentialVault;
  policyGuard: PolicyGuard;
  approvalEngine: ApprovalEngine;
  budgetGovernor: BudgetGovernor;
  providerDetector: ProviderDetector;
  mcpManager: McpManager;
  officeMcpServer: OfficeMcpServer;
  officeMcpUrlRef: { url: string };
  supervisor: JobSupervisor;
  repos: {
    conversations: ConversationsRepository;
    runs: RunsRepository;
    tasks: TasksRepository;
    approvals: ApprovalsRepository;
    usage: UsageRepository;
    audit: AuditRepository;
    memory: MemoryRepository;
    learning: LearningProposalsRepository;
    plans: TaskPlansRepository;
    meetings: MeetingsRepository;
    hiring: HiringProposalsRepository;
    schedules: SchedulesRepository;
    telegram: TelegramRepository;
  };
  close: () => Promise<void>;
}

export interface CreateOfficeServerOptions {
  companyRoot: string;
  dataDir: string;
  dbPath?: string;
  enableWatcher?: boolean;
  enableAutomationPollers?: boolean;
  maxConcurrentRuns?: number;
  defaultTimeoutMs?: number;
  deltaFlushIntervalMs?: number;
  probeProvidersOnBoot?: boolean;
  vaultKeyProvider?: MasterKeyProvider;
  directApiBaseUrls?: Partial<Record<DirectApiProvider, string>>;
  ollamaBaseUrl?: string;
  embeddingProvider?: EmbeddingProvider;
  telegramApiBaseUrl?: string;
  webDistDir?: string;
}

const TaskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignedEmployeeId: z.string().nullable().optional(),
  deliverables: z.array(z.string()).optional(),
});

export async function createOfficeServer(
  options: CreateOfficeServerOptions,
): Promise<OfficeAppContext> {
  const dbPath = options.dbPath ?? path.join(options.dataDir, "office.db");
  const authPath = path.join(options.dataDir, "auth.token");
  const vaultPath = path.join(options.dataDir, "vault.enc.json");
  const artifactsDir = path.join(options.dataDir, "artifacts");

  const db = new OfficeDatabase(dbPath);
  const repos = {
    conversations: new ConversationsRepository(db.db),
    runs: new RunsRepository(db.db),
    tasks: new TasksRepository(db.db),
    approvals: new ApprovalsRepository(db.db),
    usage: new UsageRepository(db.db),
    audit: new AuditRepository(db.db),
    memory: new MemoryRepository(db.db),
    learning: new LearningProposalsRepository(db.db),
    plans: new TaskPlansRepository(db.db),
    meetings: new MeetingsRepository(db.db),
    hiring: new HiringProposalsRepository(db.db),
    schedules: new SchedulesRepository(db.db),
    telegram: new TelegramRepository(db.db),
  };

  const memoryIndexer = new MemoryIndexer(options.companyRoot, repos.memory);
  const companyStore = new CompanyStore(options.companyRoot, memoryIndexer);
  if (options.enableWatcher !== false) {
    companyStore.startWatching();
  }

  const auth = new LocalAuthManager(authPath);
  const vault = new CredentialVault(vaultPath, options.vaultKeyProvider);
  const policyGuard = new PolicyGuard(companyStore);
  const approvalEngine = new ApprovalEngine(repos.approvals, repos.audit, companyStore);
  const budgetGovernor = new BudgetGovernor(companyStore, repos.usage);
  const providerDetector = new ProviderDetector(vault);
  if (options.probeProvidersOnBoot) {
    await providerDetector.detectAll();
  }

  const vectorStore = new VectorStore(repos.memory, options.embeddingProvider);
  const memoryManager = new MemoryManager(
    companyStore,
    repos.memory,
    memoryIndexer,
    vectorStore,
    repos.audit,
  );
  const learningEngine = new LearningEngine(
    companyStore,
    repos.memory,
    memoryIndexer,
    repos.learning,
    repos.runs,
    approvalEngine,
    repos.audit,
  );

  const mcpManager = new McpManager(
    options.companyRoot,
    vault,
    policyGuard,
    repos.audit,
    artifactsDir,
  );
  const officeMcpUrlRef = { url: "http://127.0.0.1:4310/mcp" };

  const supervisor = new JobSupervisor(
    companyStore,
    repos.runs,
    repos.conversations,
    repos.memory,
    repos.usage,
    repos.audit,
    policyGuard,
    approvalEngine,
    budgetGovernor,
    {
      artifactsDir,
      maxConcurrentRuns: options.maxConcurrentRuns,
      defaultTimeoutMs: options.defaultTimeoutMs,
      deltaFlushIntervalMs: options.deltaFlushIntervalMs,
      tasksRepo: repos.tasks,
      vault,
      mcpManager,
      memoryManager,
      auth,
      officeMcpUrlRef,
      directApiBaseUrls: options.directApiBaseUrls,
      ollamaBaseUrl: options.ollamaBaseUrl,
    },
  );

  const officeMcpServer = new OfficeMcpServer(
    companyStore,
    repos.memory,
    repos.tasks,
    repos.runs,
    approvalEngine,
    (runId) => supervisor.emitRunStatus(runId),
    memoryManager,
  );

  const dagEngine = new OrchestratorDagEngine(
    companyStore,
    repos.plans,
    repos.tasks,
    repos.runs,
    repos.audit,
    supervisor,
  );
  const meetingEngine = new MeetingEngine(
    companyStore,
    repos.meetings,
    repos.tasks,
    repos.runs,
    repos.audit,
    supervisor,
  );
  const hiringEngine = new HiringEngine(
    companyStore,
    memoryIndexer,
    repos.hiring,
    approvalEngine,
    repos.audit,
  );

  const decideApprovalAction = async (
    id: string,
    input: ApprovalDecisionInput,
  ): Promise<ApprovalDecideResult> => {
    const result = await approvalEngine.decide(id, input, async (approval) => {
      let extra: Record<string, unknown> = {};
      if (
        approval.actionType === "learning_apply" &&
        typeof approval.payload.proposalId === "string"
      ) {
        extra = learningEngine.applyApprovedProposal(approval.payload.proposalId, approval.id);
      } else if (
        approval.actionType === "hire_employee" &&
        typeof approval.payload.hiringProposalId === "string"
      ) {
        extra = hiringEngine.applyApprovedHire(approval.payload.hiringProposalId, approval.id);
      }

      if (approval.runId) {
        repos.runs.updateStatus(approval.runId, "COMPLETED", {
          finalOutput: `Approved & executed: ${approval.actionType}`,
          finished: true,
        });
        supervisor.emitRunStatus(approval.runId);
        dagEngine.handleRunTerminal(approval.runId);
      }
      return {
        executedAt: new Date().toISOString(),
        actionType: approval.actionType,
        payload: approval.payload,
        ...extra,
      };
    });

    if (result.status === "REJECTED") {
      if (
        result.approval.actionType === "learning_apply" &&
        typeof result.approval.payload.proposalId === "string"
      ) {
        learningEngine.markProposalRejected(
          result.approval.payload.proposalId,
          input.note,
        );
      } else if (
        result.approval.actionType === "hire_employee" &&
        typeof result.approval.payload.hiringProposalId === "string"
      ) {
        hiringEngine.markProposalRejected(
          result.approval.payload.hiringProposalId,
          input.note,
        );
      }
      if (result.approval.runId) {
        repos.runs.updateStatus(result.approval.runId, "CANCELLED", {
          errorCode: "CANCELLED",
          errorMessage: "Approval rejected by founder.",
          finished: true,
        });
        supervisor.emitRunStatus(result.approval.runId);
        dagEngine.handleRunTerminal(result.approval.runId);
      }
    }

    return result;
  };

  const officeBus = new EventEmitter();
  const analyticsService = new AnalyticsService(db.db);
  const gitBackup = new GitBackupManager(companyStore, memoryIndexer, repos.audit);

  const enableAutomation = options.enableAutomationPollers ?? options.enableWatcher !== false;
  const cronScheduler = new CronScheduler(
    companyStore,
    repos.schedules,
    repos.runs,
    repos.audit,
    supervisor,
    { enableAutoTick: enableAutomation },
  );
  const telegramBridge = new TelegramBridge(
    companyStore,
    vault,
    repos.telegram,
    repos.runs,
    repos.approvals,
    approvalEngine,
    repos.usage,
    repos.audit,
    supervisor,
    decideApprovalAction,
    {
      apiBaseUrl: options.telegramApiBaseUrl,
      enablePolling: enableAutomation,
    },
  );

  const app = Fastify({ logger: false });

  // Enforce strict Localhost Host + Origin + Bearer Token BEFORE CORS so rejected origins return 403
  app.addHook("onRequest", async (request, reply) => {
    const urlPath = request.url.split("?")[0] ?? "";
    const hostHeader = request.headers.host;
    const originHeader = request.headers.origin;

    if (!auth.isAllowedHost(hostHeader)) {
      return reply.code(403).send({ error: "Forbidden host header" });
    }
    if (!auth.isAllowedOrigin(originHeader)) {
      return reply.code(403).send({ error: "Forbidden origin header" });
    }

    if (urlPath === "/api/health") {
      return;
    }

    if (urlPath.startsWith("/api/") || urlPath === "/ws") {
      const query = request.query as Record<string, string | undefined>;
      const ok = auth.verifyBearerToken(request.headers.authorization, query?.token);
      if (!ok) {
        return reply.code(401).send({ error: "Unauthorized: valid Bearer token required" });
      }
    }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, !origin || auth.isAllowedOrigin(origin));
    },
    credentials: true,
  });

  await app.register(websocket);

  app.get("/api/health", async () => {
    return { ok: true, time: new Date().toISOString() };
  });

  app.get("/api/bootstrap", async () => {
    return {
      company: companyStore.getCompanyConfig(),
      employees: companyStore.listEmployees().map((e) => ({
        profile: e.profile,
        permissions: e.permissions,
        skillsCount: e.skills.length,
      })),
      projects: companyStore.listProjects(),
      pendingApprovalsCount: repos.approvals.list("PENDING").length,
      activeRunsCount: supervisor.getActiveCount(),
      queuedRunsCount: supervisor.getQueuedCount(),
      providers: providerDetector.getCached(),
    };
  });

  app.get("/api/providers/health", async () => {
    const cached = providerDetector.getCached();
    if (cached.length === 0) {
      return { providers: await providerDetector.detectAll() };
    }
    return { providers: cached };
  });

  app.post("/api/providers/refresh", async () => {
    return { providers: await providerDetector.detectAll() };
  });

  app.get("/api/employees", async () => {
    return { employees: companyStore.listEmployees() };
  });

  app.get("/api/employees/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const employee = companyStore.getEmployee(id);
    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }
    return {
      employee,
      conversations: repos.conversations.listByEmployee(id, 20),
    };
  });

  app.get("/api/projects", async () => {
    return { projects: companyStore.listProjects() };
  });

  app.post("/api/projects", async (req, reply) => {
    const parsed = RegisterProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const project = companyStore.registerProject(parsed.data);
      repos.audit.log({
        actorType: "human",
        actorId: "founder",
        action: "project.registered",
        targetType: "project",
        targetId: project.id,
        status: "OK",
        details: { rootPath: project.rootPath, isGitRepo: project.isGitRepo },
      });
      return reply.code(201).send({ project });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to register project",
      });
    }
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = companyStore.removeProject(id);
    if (!removed) {
      return reply.code(404).send({ error: "Project not found" });
    }
    repos.audit.log({
      actorType: "human",
      actorId: "founder",
      action: "project.removed",
      targetType: "project",
      targetId: id,
      status: "OK",
    });
    return { ok: true };
  });

  app.get("/api/tasks", async (req) => {
    const query = req.query as { projectId?: string; status?: string };
    const parsedStatus = query.status ? TaskStatusSchema.safeParse(query.status) : null;
    return {
      tasks: repos.tasks.list({
        projectId: query.projectId,
        status: parsedStatus?.success ? parsedStatus.data : undefined,
      }),
    };
  });

  app.post("/api/tasks", async (req, reply) => {
    const parsed = CreateTaskInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const task = repos.tasks.create(parsed.data);
    return reply.code(201).send({ task });
  });

  app.patch("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = TaskPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const updated = repos.tasks.update(id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return { task: updated };
  });

  app.post("/api/runs", async (req, reply) => {
    const parsed = CreateRunInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const run = supervisor.enqueueRun(parsed.data);
      const code = run.status === "BUDGET_EXCEEDED" ? 402 : 202;
      return reply.code(code).send({ run });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to enqueue run",
      });
    }
  });

  app.get("/api/runs", async (req) => {
    const query = req.query as { employeeId?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const runs = repos.runs.listRecent(limit);
    return {
      runs: query.employeeId ? runs.filter((r) => r.employeeId === query.employeeId) : runs,
    };
  });

  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = repos.conversations.getById(id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    return {
      conversation,
      messages: repos.conversations.listMessages(id, 100),
    };
  });

  app.post("/api/conversations/:id/summarize", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = repos.conversations.getById(id);
    if (!existing) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    const threshold =
      companyStore.getCompanyConfig().memory?.rollingSummaryEveryMessages ?? 8;
    const conversation = updateRollingSummaryIfNeeded(
      repos.conversations,
      id,
      threshold,
      true,
    );
    return { conversation: conversation ?? existing };
  });

  app.get("/api/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repos.runs.getById(id);
    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }
    return { run };
  });

  app.get("/api/runs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repos.runs.getById(id);
    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }
    const query = req.query as { afterSeq?: string };
    const afterSeq = Number(query.afterSeq ?? 0);
    return {
      runId: id,
      status: run.status,
      events: repos.runs.getRunEventsAfter(id, Number.isFinite(afterSeq) ? afterSeq : 0),
    };
  });

  app.post("/api/runs/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = repos.runs.getById(id);
    if (!run) {
      return reply.code(404).send({ error: "Run not found" });
    }
    const cancelled = supervisor.cancelRun(id);
    return { ok: cancelled, run: repos.runs.getById(id) };
  });

  app.get("/api/approvals", async (req) => {
    const query = req.query as { status?: string };
    const parsed = query.status ? ApprovalStatusSchema.safeParse(query.status) : null;
    return {
      approvals: repos.approvals.list(parsed?.success ? parsed.data : undefined),
    };
  });

  app.post("/api/approvals/:id/decide", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ApprovalDecisionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await decideApprovalAction(id, parsed.data);

    if (result.status === "NOT_FOUND") {
      return reply.code(404).send({ error: "Approval not found" });
    }
    if (result.status === "EXPIRED") {
      return reply.code(410).send(result);
    }
    if (result.status === "ALREADY_DECIDED") {
      return reply.code(409).send(result);
    }
    if (result.status === "PRECONDITION_DRIFT") {
      return reply.code(409).send(result);
    }
    return reply.code(200).send(result);
  });

  app.get("/api/memory/search", async (req, reply) => {
    const parsed = MemorySearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { entries, meta } = await memoryManager.search({
      q: parsed.data.q,
      scope: parsed.data.scope,
      projectId: parsed.data.projectId,
      employeeId: parsed.data.employeeId,
      status: parsed.data.status,
      memoryType: parsed.data.memoryType,
      includeArchived: parsed.data.includeArchived,
      limit: parsed.data.limit,
    });
    return { entries, meta };
  });

  app.post("/api/memory/notes", async (req, reply) => {
    const parsed = CreateMemoryNoteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = await memoryManager.writeMemoryEntry(parsed.data, {
        strictTypeCheck: true,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to create memory note",
      });
    }
  });

  app.post("/api/memory/:id/promote", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PromoteMemoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = await memoryManager.promoteMemoryEntry(id, parsed.data);
      return reply.code(200).send(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to promote memory entry";
      const code = msg.includes("not found") ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  app.get("/api/memory/conflicts", async () => {
    const conflictEntries = repos.memory.listConflicts();
    return {
      conflicts: conflictEntries.map((entry) => ({
        entry,
        existing: entry.conflictWithId ? repos.memory.getById(entry.conflictWithId) : null,
      })),
    };
  });

  app.post("/api/memory/conflicts/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ResolveConflictInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = await memoryManager.resolveConflict(id, parsed.data);
      return reply.code(200).send(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to resolve conflict";
      const code = msg.includes("not found") ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  app.post("/api/memory/recalculate-decay", async () => {
    return memoryManager.recalculateAllDecay();
  });

  app.get("/api/memory/vectors/status", async () => {
    return { vectorStatus: await memoryManager.getVectorStatus() };
  });

  app.post("/api/memory/vectors/sync", async () => {
    const result = await memoryManager.syncVectors();
    const vectorStatus = await memoryManager.getVectorStatus();
    return { result, vectorStatus };
  });

  app.get("/api/learning/proposals", async (req) => {
    const query = req.query as { status?: string; employeeId?: string; limit?: string };
    const parsedStatus = query.status ? LearningProposalStatusSchema.safeParse(query.status) : null;
    const limit = Number(query.limit ?? 100);
    return {
      proposals: repos.learning.list({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        employeeId: query.employeeId,
        limit: Number.isFinite(limit) ? limit : 100,
      }),
    };
  });

  app.post("/api/learning/feedback", async (req, reply) => {
    const parsed = SubmitFeedbackInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = learningEngine.submitFeedback(parsed.data);
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to submit learning feedback",
      });
    }
  });

  app.post("/api/learning/proposals/:id/rollback", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = RollbackProposalInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const result = learningEngine.rollbackProposal(id, parsed.data);
    if (!result.ok) {
      const code =
        result.status === "NOT_FOUND"
          ? 404
          : result.status === "DRIFT_DETECTED"
            ? 409
            : 400;
      return reply.code(code).send({ error: result.reason, status: result.status });
    }
    return reply.code(200).send({ proposal: result.proposal });
  });

  app.get("/api/audit", async (req, reply) => {
    const query = req.query as {
      limit?: string;
      actorType?: string;
      status?: string;
      q?: string;
      format?: string;
    };
    const rawLimit = Number(query.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
    const logs = repos.audit.listFiltered({
      limit,
      actorType: query.actorType,
      status: query.status,
      actionQuery: query.q,
    });
    if (query.format === "csv") {
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", 'attachment; filename="virtual-office-audit.csv"');
      return reply.send(formatAuditLogsCsv(logs));
    }
    return { logs };
  });

  app.get("/api/analytics", async (req) => {
    const query = req.query as { days?: string };
    const rawDays = Number(query.days ?? 14);
    const days = Number.isFinite(rawDays) ? rawDays : 14;
    return { analytics: analyticsService.getSummary(days) };
  });

  app.get("/api/usage", async () => {
    return { usage: repos.usage.getSummary() };
  });

  // Encrypted Vault routes (masked summaries ONLY — raw values never returned)
  app.get("/api/vault/keys", async () => {
    return { keys: vault.listKeys() };
  });

  app.put("/api/vault/keys/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const bodySchema = z.object({
      value: z.string().min(1),
      providerHint: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const summary = vault.setSecret(key, parsed.data.value, parsed.data.providerHint);
      repos.audit.log({
        actorType: "human",
        actorId: "founder",
        action: "vault.key_saved",
        targetType: "vault_key",
        targetId: summary.key,
        status: "OK",
      });
      await providerDetector.detectAll();
      if (summary.key === "TELEGRAM_BOT_TOKEN") {
        telegramBridge.refreshPolling();
      }
      return { key: summary };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Failed to save secret",
      });
    }
  });

  app.delete("/api/vault/keys/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const deleted = vault.deleteSecret(key);
    if (!deleted) {
      return reply.code(404).send({ error: "Vault key not found" });
    }
    repos.audit.log({
      actorType: "human",
      actorId: "founder",
      action: "vault.key_deleted",
      targetType: "vault_key",
      targetId: key,
      status: "OK",
    });
    await providerDetector.detectAll();
    if (key === "TELEGRAM_BOT_TOKEN") {
      telegramBridge.refreshPolling();
    }
    return { ok: true };
  });

  // External MCP Manager routes
  app.get("/api/mcps", async () => {
    return { servers: mcpManager.listServers() };
  });

  app.get("/api/mcps/templates", async () => {
    return { templates: mcpManager.getTemplates() };
  });

  app.post("/api/mcps", async (req, reply) => {
    const parsed = McpServerConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const server = mcpManager.upsertServer(parsed.data);
    return reply.code(201).send({ server });
  });

  app.patch("/api/mcps/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const partialSchema = McpServerConfigSchema.partial();
    const parsed = partialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const updated = mcpManager.patchServer(id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: "MCP server not found" });
    }
    return { server: updated };
  });

  app.delete("/api/mcps/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = mcpManager.deleteServer(id);
    if (!deleted) {
      return reply.code(404).send({ error: "MCP server not found" });
    }
    return { ok: true };
  });

  app.post("/api/mcps/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = mcpManager.getServer(id);
    if (!existing) {
      return reply.code(404).send({ error: "MCP server not found" });
    }
    const result = await mcpManager.testServer(id);
    return { result };
  });

  // Company Budget, Memory, Telegram & Security Policy routes
  app.get("/api/company/policies", async () => {
    const cfg = companyStore.getCompanyConfig();
    return {
      budgets: cfg.budgets,
      security: cfg.security ?? BrowserSecurityPolicySchema.parse({}),
      memory: cfg.memory ?? MemoryPolicySchema.parse({}),
      telegram: cfg.telegram ?? TelegramPolicySchema.parse({}),
    };
  });

  app.patch("/api/company/policies", async (req, reply) => {
    const patchSchema = z.object({
      budgets: BudgetPolicySchema.partial().optional(),
      security: BrowserSecurityPolicySchema.partial().optional(),
      memory: MemoryPolicySchema.partial().optional(),
      telegram: TelegramPolicySchema.partial().optional(),
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const updated = companyStore.updateCompanyPolicies(parsed.data);
    if (parsed.data.telegram) {
      telegramBridge.refreshPolling();
    }
    repos.audit.log({
      actorType: "human",
      actorId: "founder",
      action: "company.policies_updated",
      targetType: "company",
      targetId: "company.json",
      status: "OK",
      details: parsed.data,
    });
    return {
      budgets: updated.budgets,
      security: updated.security ?? BrowserSecurityPolicySchema.parse({}),
      memory: updated.memory ?? MemoryPolicySchema.parse({}),
      telegram: updated.telegram ?? TelegramPolicySchema.parse({}),
    };
  });

  app.put("/api/company/floorplan", async (req, reply) => {
    const parsed = UpdateFloorplanLayoutInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const updated = companyStore.updateFloorplanLayout(parsed.data);
      officeBus.emit("company_updated", updated);
      repos.audit.log({
        actorType: "human",
        actorId: "founder",
        action: "office.floorplan_updated",
        targetType: "company",
        targetId: "company.json",
        status: "OK",
        details: {
          theme: updated.floorplan.theme ?? "sunlit_studio",
          zones: updated.floorplan.zones.length,
          desks: updated.floorplan.desks.length,
          width: updated.floorplan.width,
          height: updated.floorplan.height,
        },
      });
      return { company: updated };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to update floorplan layout",
      });
    }
  });

  // Orchestrator Task DAG routes
  app.get("/api/plans", async (req) => {
    const query = req.query as { limit?: string };
    const limit = Number(query.limit ?? 50);
    return { plans: repos.plans.listPlans(Number.isFinite(limit) ? limit : 50) };
  });

  app.get("/api/plans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = repos.plans.getPlanById(id);
    if (!plan) {
      return reply.code(404).send({ error: "Task plan not found" });
    }
    return { plan };
  });

  app.post("/api/plans", async (req, reply) => {
    const parsed = CreateTaskPlanInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const plan = dagEngine.createPlan(parsed.data);
      return reply.code(201).send({ plan });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to create task plan",
      });
    }
  });

  app.post("/api/plans/:id/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = dagEngine.startPlan(id);
    if (!plan) {
      return reply.code(404).send({ error: "Task plan not found" });
    }
    return { plan };
  });

  app.post("/api/plans/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = dagEngine.cancelPlan(id);
    if (!plan) {
      return reply.code(404).send({ error: "Task plan not found" });
    }
    return { plan };
  });

  // Bounded Meeting Room routes
  app.get("/api/meetings", async (req) => {
    const query = req.query as { limit?: string };
    const limit = Number(query.limit ?? 50);
    return { meetings: repos.meetings.list(Number.isFinite(limit) ? limit : 50) };
  });

  app.get("/api/meetings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const meeting = repos.meetings.getById(id);
    if (!meeting) {
      return reply.code(404).send({ error: "Meeting not found" });
    }
    return { meeting };
  });

  app.post("/api/meetings", async (req, reply) => {
    const parsed = CreateMeetingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const meeting = meetingEngine.startMeeting(parsed.data);
      return reply.code(201).send({ meeting });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to start meeting",
      });
    }
  });

  app.post("/api/meetings/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const meeting = meetingEngine.cancelMeeting(id);
    if (!meeting) {
      return reply.code(404).send({ error: "Meeting not found" });
    }
    return { meeting };
  });

  // HR Hiring Workflow routes
  app.get("/api/hiring/templates", async () => {
    return { templates: hiringEngine.getRoleTemplates() };
  });

  app.get("/api/hiring/proposals", async (req) => {
    const query = req.query as { status?: string };
    const parsedStatus = query.status ? HiringProposalStatusSchema.safeParse(query.status) : null;
    return {
      proposals: repos.hiring.list(parsedStatus?.success ? parsedStatus.data : undefined),
    };
  });

  app.post("/api/hiring/proposals", async (req, reply) => {
    const parsed = CreateHiringProposalInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const res = hiringEngine.createProposal(parsed.data);
      return reply.code(201).send(res);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to create hiring proposal",
      });
    }
  });

  app.post("/api/hiring/proposals/:id/rollback", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as { reason?: string };
    try {
      const proposal = hiringEngine.rollbackHire(id, body.reason);
      return reply.code(200).send({ proposal });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to rollback hire";
      return reply.code(msg.includes("not found") ? 404 : 400).send({ error: msg });
    }
  });

  // Cron Scheduler routes
  app.get("/api/schedules", async () => {
    return {
      jobs: repos.schedules.list(),
      presets: CRON_PRESETS,
      recentRuns: repos.schedules.listJobRuns(undefined, 40),
    };
  });

  app.post("/api/schedules", async (req, reply) => {
    const parsed = CreateScheduledJobInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const job = cronScheduler.createJob(parsed.data);
      return reply.code(201).send({ job });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to create schedule",
      });
    }
  });

  app.patch("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateScheduledJobInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const job = cronScheduler.updateJob(id, parsed.data);
      if (!job) {
        return reply.code(404).send({ error: "Scheduled job not found" });
      }
      return { job };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to update schedule",
      });
    }
  });

  app.delete("/api/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = cronScheduler.deleteJob(id);
    if (!ok) {
      return reply.code(404).send({ error: "Scheduled job not found" });
    }
    return { ok: true };
  });

  app.post("/api/schedules/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = cronScheduler.triggerJob(id, "manual");
    if (!res.job) {
      return reply.code(404).send({ error: "Scheduled job not found" });
    }
    return reply.code(res.triggered ? 200 : 429).send(res);
  });

  // Bidirectional Telegram Bridge routes
  app.get("/api/telegram/status", async () => {
    return {
      status: telegramBridge.getStatus(),
      policy: telegramBridge.getPolicy(),
      messages: repos.telegram.listRecent(50),
    };
  });

  app.post("/api/telegram/test", async () => {
    const result = await telegramBridge.testConnection();
    return { result, status: telegramBridge.getStatus() };
  });

  app.post("/api/telegram/simulate", async (req, reply) => {
    const simSchema = z.object({
      chatId: z.string().min(1),
      text: z.string().optional(),
      callbackData: z.string().optional(),
      mode: RunModeSchema.optional(),
    });
    const parsed = simSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const result = await telegramBridge.simulateInbound(parsed.data);
    return {
      ...result,
      status: telegramBridge.getStatus(),
      messages: repos.telegram.listRecent(50),
    };
  });

  // Company Git Backup & Portable Export routes (scoped strictly to company/, never data/)
  app.get("/api/backup/status", async (req) => {
    const query = req.query as { limit?: string };
    const limit = Number(query.limit ?? 20);
    return { status: await gitBackup.getStatus(Number.isFinite(limit) ? limit : 20) };
  });

  app.post("/api/backup/init", async (_req, reply) => {
    try {
      const status = await gitBackup.initRepo();
      return { status };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to initialize Git backup",
      });
    }
  });

  app.post("/api/backup/snapshot", async (req, reply) => {
    const parsed = CreateGitSnapshotInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      return await gitBackup.createSnapshot(parsed.data.message);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to create Git snapshot",
      });
    }
  });

  app.get("/api/backup/diff", async (req, reply) => {
    const query = req.query as { commit?: string };
    try {
      const diff = await gitBackup.getDiff(query.commit);
      return { diff };
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to inspect Git diff",
      });
    }
  });

  app.post("/api/backup/restore", async (req, reply) => {
    const parsed = RestoreGitSnapshotInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = await gitBackup.restoreSnapshot(parsed.data.commitHash);
      officeBus.emit("company_updated", companyStore.getCompanyConfig());
      return result;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to restore Git snapshot",
      });
    }
  });

  app.get("/api/backup/export", async (_req, reply) => {
    const bundle = gitBackup.buildExportBundle();
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="company-export.json"');
    return reply.send(JSON.stringify(bundle, null, 2));
  });

  // Safe local serving of company-scoped 3D GLB avatar assets (Phase 8C)
  const avatarsRoot = path.resolve(options.companyRoot, "assets", "avatars");
  const avatarsPrefix = avatarsRoot.endsWith(path.sep) ? avatarsRoot : `${avatarsRoot}${path.sep}`;
  app.get("/company-assets/avatars/:filename", async (req, reply) => {
    const rawUrl = (req.raw.url ?? req.url).split("?")[0] ?? "";
    const { filename } = req.params as { filename?: string };
    if (
      !filename ||
      !/^[a-zA-Z0-9._-]+\.glb$/.test(filename) ||
      filename.includes("..") ||
      rawUrl.includes("..") ||
      /%2e/i.test(rawUrl)
    ) {
      return reply.code(400).send({ error: "Invalid avatar filename" });
    }
    const candidate = path.resolve(avatarsRoot, filename);
    if (!candidate.startsWith(avatarsPrefix)) {
      return reply.code(403).send({ error: "Forbidden path" });
    }
    if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
      return reply.code(404).send({ error: "Avatar asset not found" });
    }
    reply.header("Content-Type", "model/gltf-binary");
    reply.header("Cache-Control", "no-store");
    return reply.send(fs.readFileSync(candidate));
  });

  // Standalone built SPA & local session bridge (when built dist/ directory is present)
  if (options.webDistDir) {
    const resolvedWebDist = path.resolve(options.webDistDir);
    if (fs.existsSync(resolvedWebDist)) {
      const mimeByExt: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
      };
      const distPrefix = resolvedWebDist.endsWith(path.sep)
        ? resolvedWebDist
        : `${resolvedWebDist}${path.sep}`;

      app.get("/__office_session", async (req, reply) => {
        if (req.headers["sec-fetch-site"] === "cross-site") {
          return reply.code(403).send({ error: "Forbidden cross-site session access" });
        }
        const addr = app.server.address();
        const serverPort = typeof addr === "object" && addr ? addr.port : 4310;
        reply.header("Cache-Control", "no-store");
        return { token: auth.sessionToken, port: serverPort };
      });

      app.setNotFoundHandler((req, reply) => {
        const rawUrl = (req.raw.url ?? req.url).split("?")[0] ?? "/";
        if (
          (req.method !== "GET" && req.method !== "HEAD") ||
          rawUrl.startsWith("/api/") ||
          rawUrl.startsWith("/mcp") ||
          rawUrl === "/ws"
        ) {
          return reply.code(404).send({ error: "Not found" });
        }

        let decoded = rawUrl;
        try {
          decoded = decodeURIComponent(rawUrl);
        } catch {
          return reply.code(400).send({ error: "Malformed URI" });
        }

        if (decoded.includes("\0") || decoded.split(/[\\/]/).some((seg) => seg === "..")) {
          return reply.code(403).send({ error: "Forbidden path" });
        }

        const relPath = decoded.replace(/^\/+/, "");
        const candidate = relPath
          ? path.resolve(resolvedWebDist, relPath)
          : path.join(resolvedWebDist, "index.html");

        if (candidate !== resolvedWebDist && !candidate.startsWith(distPrefix)) {
          return reply.code(403).send({ error: "Forbidden path" });
        }

        let fileToServe = candidate;
        if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
          if (relPath && path.extname(relPath)) {
            return reply.code(404).send({ error: "Asset not found" });
          }
          fileToServe = path.join(resolvedWebDist, "index.html");
          if (!fs.existsSync(fileToServe)) {
            return reply.code(404).send({ error: "Frontend index.html not found" });
          }
        }

        const ext = path.extname(fileToServe).toLowerCase();
        reply.header("Content-Type", mimeByExt[ext] ?? "application/octet-stream");
        if (ext === ".html") {
          reply.header("Cache-Control", "no-store");
        }
        return reply.send(fs.readFileSync(fileToServe));
      });
    }
  }

  // Internal `office-mcp` HTTP JSON-RPC 2.0 endpoint authenticated strictly by Run-Scoped Token
  app.post("/mcp", async (req, reply) => {
    const header = req.headers.authorization;
    const rawToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const claims = auth.verifyRunToken(rawToken);
    if (!claims) {
      return reply.code(401).send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: valid run-scoped token required" },
      });
    }

    const body = req.body as JsonRpcRequest | undefined;
    if (!body || typeof body.method !== "string") {
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
    }

    const response = await officeMcpServer.handleJsonRpc(body, claims);
    if (response === null) {
      return reply.code(204).send();
    }
    return reply.code(200).send(response);
  });

  // WebSocket live event stream with `afterSeq` replay support
  app.get("/ws", { websocket: true }, (socket) => {
    let subscribedRunId: string | undefined;

    const onRunEvent = (payload: RunBusEvent): void => {
      if (subscribedRunId && payload.runId !== subscribedRunId) {
        return;
      }
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "run_event",
            data: payload.storedEvent,
          }),
        ),
      );
    };

    const onLiveDelta = (payload: RunBusEvent): void => {
      if (subscribedRunId && payload.runId !== subscribedRunId) {
        return;
      }
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "live_delta",
            data: payload.storedEvent,
          }),
        ),
      );
    };

    const onRunStatus = (payload: { run: unknown }): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "run_status",
            data: payload.run,
          }),
        ),
      );
    };

    const onPlanUpdated = (plan: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "plan_updated",
            data: plan,
          }),
        ),
      );
    };

    const onMeetingUpdated = (meeting: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "meeting_updated",
            data: meeting,
          }),
        ),
      );
    };

    const onHiringUpdated = (proposal: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "hiring_updated",
            data: proposal,
          }),
        ),
      );
    };

    const onScheduleUpdated = (job: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "schedule_updated",
            data: job,
          }),
        ),
      );
    };

    const onTelegramMessage = (msg: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "telegram_message",
            data: msg,
          }),
        ),
      );
    };

    const onCompanyUpdated = (cfg: unknown): void => {
      socket.send(
        redactSecrets(
          JSON.stringify({
            kind: "company_updated",
            data: cfg,
          }),
        ),
      );
    };

    supervisor.bus.on("run_event", onRunEvent);
    supervisor.bus.on("run_live_delta", onLiveDelta);
    supervisor.bus.on("run_status", onRunStatus);
    dagEngine.bus.on("plan_updated", onPlanUpdated);
    meetingEngine.bus.on("meeting_updated", onMeetingUpdated);
    hiringEngine.bus.on("hiring_updated", onHiringUpdated);
    cronScheduler.bus.on("schedule_updated", onScheduleUpdated);
    telegramBridge.bus.on("telegram_message", onTelegramMessage);
    officeBus.on("company_updated", onCompanyUpdated);

    socket.on("message", (rawMessage: Buffer) => {
      try {
        const msg = JSON.parse(rawMessage.toString("utf8")) as {
          type?: string;
          runId?: string;
          afterSeq?: number;
        };
        if (msg.type === "subscribe") {
          subscribedRunId = msg.runId;
          const afterSeq = Number(msg.afterSeq ?? 0);
          const missed = msg.runId
            ? repos.runs.getRunEventsAfter(msg.runId, afterSeq)
            : repos.runs.getGlobalEventsAfter(afterSeq, 200);
          socket.send(
            redactSecrets(
              JSON.stringify({
                kind: "replay",
                runId: msg.runId ?? null,
                events: missed,
              }),
            ),
          );
        }
      } catch {
        socket.send(JSON.stringify({ kind: "error", message: "Invalid WS message payload" }));
      }
    });

    socket.on("close", () => {
      supervisor.bus.off("run_event", onRunEvent);
      supervisor.bus.off("run_live_delta", onLiveDelta);
      supervisor.bus.off("run_status", onRunStatus);
      dagEngine.bus.off("plan_updated", onPlanUpdated);
      meetingEngine.bus.off("meeting_updated", onMeetingUpdated);
      hiringEngine.bus.off("hiring_updated", onHiringUpdated);
      cronScheduler.bus.off("schedule_updated", onScheduleUpdated);
      telegramBridge.bus.off("telegram_message", onTelegramMessage);
      officeBus.off("company_updated", onCompanyUpdated);
    });
  });

  const close = async (): Promise<void> => {
    cronScheduler.shutdown();
    telegramBridge.shutdown();
    dagEngine.shutdown();
    meetingEngine.shutdown();
    await supervisor.shutdown();
    await mcpManager.shutdown();
    await companyStore.stopWatching();
    await app.close();
    db.close();
  };

  return {
    app,
    db,
    companyStore,
    memoryIndexer,
    vectorStore,
    memoryManager,
    learningEngine,
    dagEngine,
    meetingEngine,
    hiringEngine,
    cronScheduler,
    telegramBridge,
    analyticsService,
    gitBackup,
    auth,
    vault,
    policyGuard,
    approvalEngine,
    budgetGovernor,
    providerDetector,
    mcpManager,
    officeMcpServer,
    officeMcpUrlRef,
    supervisor,
    repos,
    close,
  };
}
