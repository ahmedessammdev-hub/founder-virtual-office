import type {
  AnalyticsSummary,
  ApprovalDecisionInput,
  ApprovalRequest,
  ApprovalStatus,
  BrowserSecurityPolicy,
  BudgetPolicy,
  CompanyConfig,
  CreateHiringProposalInput,
  CreateMeetingInput,
  CreateMemoryNoteInput,
  CreateRunInput,
  CreateScheduledJobInput,
  CreateTaskInput,
  CreateTaskPlanInput,
  CronPreset,
  GitBackupStatus,
  HiringProposal,
  HiringProposalStatus,
  HiringRoleTemplate,
  LearningProposal,
  LearningProposalStatus,
  LoadedEmployee,
  McpServerConfig,
  McpServerConfigInput,
  MeetingRecord,
  MemoryEntry,
  MemoryPolicy,
  MemoryScope,
  MemorySearchMeta,
  MemoryStatus,
  MemoryType,
  NormalizedAgentEvent,
  Project,
  PromoteMemoryInput,
  ProviderHealth,
  RegisterProjectInput,
  ResolveConflictInput,
  RollbackProposalInput,
  Run,
  RunMode,
  ScheduledJob,
  ScheduledJobRunRecord,
  SubmitFeedbackInput,
  Task,
  TaskPlan,
  TaskStatus,
  TelegramMessageRecord,
  TelegramPolicy,
  TelegramStatus,
  UpdateFloorplanLayoutInput,
  UpdateScheduledJobInput,
  VaultKeySummary,
  VectorStatus,
} from "@virtual-office/shared";

export interface ConversationRecord {
  id: string;
  employeeId: string;
  projectId: string | null;
  title: string | null;
  externalSessionId: string | null;
  runtimeProvider: string | null;
  rollingSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface StoredRunEvent {
  seq: number;
  runId: string;
  runSeq: number;
  eventType: string;
  event: NormalizedAgentEvent;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  actorType: "human" | "employee" | "system";
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface McpTemplate {
  id: string;
  name: string;
  description: string;
  config: McpServerConfigInput;
}

export interface McpTestResult {
  ok: boolean;
  serverId: string;
  latencyMs: number;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
}

export interface CompanyPoliciesResponse {
  budgets: BudgetPolicy;
  security: BrowserSecurityPolicy;
  memory: MemoryPolicy;
  telegram: TelegramPolicy;
}

export interface MemoryConflictItem {
  entry: MemoryEntry;
  existing: MemoryEntry | null;
}

export interface UsageSummary {
  liveTodayUsd: number;
  byEmployee: Array<{
    employeeId: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byProvider: Array<{
    provider: string;
    mode: string;
    costUsd: number;
  }>;
}

export interface BootstrapResponse {
  company: CompanyConfig;
  employees: Array<{
    profile: LoadedEmployee["profile"];
    permissions: LoadedEmployee["permissions"];
    skillsCount: number;
  }>;
  projects: Project[];
  pendingApprovalsCount: number;
  activeRunsCount: number;
  queuedRunsCount: number;
  providers: ProviderHealth[];
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function fetchLocalSession(): Promise<{ token: string; port: number }> {
  const res = await fetch("/__office_session", { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(res.status, "Local Virtual Office session not ready");
  }
  return (await res.json()) as { token: string; port: number };
}

async function apiRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    if (typeof data === "object" && data && "error" in data) {
      const rawErr = (data as { error: unknown }).error;
      errMsg = typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr);
    }
    throw new ApiError(res.status, errMsg, data);
  }
  return data as T;
}

async function downloadAuthorizedFile(
  token: string,
  path: string,
  filename: string,
): Promise<void> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Download failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const officeApi = {
  getBootstrap: (token: string) => apiRequest<BootstrapResponse>(token, "/api/bootstrap"),
  getProviders: (token: string) =>
    apiRequest<{ providers: ProviderHealth[] }>(token, "/api/providers/health"),
  refreshProviders: (token: string) =>
    apiRequest<{ providers: ProviderHealth[] }>(token, "/api/providers/refresh", {
      method: "POST",
    }),
  getEmployees: (token: string) =>
    apiRequest<{ employees: LoadedEmployee[] }>(token, "/api/employees"),
  getEmployeeDetail: (token: string, id: string) =>
    apiRequest<{ employee: LoadedEmployee; conversations: ConversationRecord[] }>(
      token,
      `/api/employees/${encodeURIComponent(id)}`,
    ),
  getConversationMessages: (token: string, conversationId: string) =>
    apiRequest<{ conversation: ConversationRecord; messages: MessageRecord[] }>(
      token,
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    ),
  summarizeConversation: (token: string, conversationId: string) =>
    apiRequest<{ conversation: ConversationRecord }>(
      token,
      `/api/conversations/${encodeURIComponent(conversationId)}/summarize`,
      { method: "POST" },
    ),
  getProjects: (token: string) => apiRequest<{ projects: Project[] }>(token, "/api/projects"),
  registerProject: (token: string, input: RegisterProjectInput) =>
    apiRequest<{ project: Project }>(token, "/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteProject: (token: string, id: string) =>
    apiRequest<{ ok: boolean }>(token, `/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getTasks: (token: string, projectId?: string) =>
    apiRequest<{ tasks: Task[] }>(
      token,
      projectId ? `/api/tasks?projectId=${encodeURIComponent(projectId)}` : "/api/tasks",
    ),
  createTask: (token: string, input: CreateTaskInput) =>
    apiRequest<{ task: Task }>(token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  patchTask: (
    token: string,
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      status: TaskStatus;
      priority: Task["priority"];
      assignedEmployeeId: string | null;
      deliverables: string[];
    }>,
  ) =>
    apiRequest<{ task: Task }>(token, `/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  getRuns: (token: string, employeeId?: string, limit = 50) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (employeeId) qs.set("employeeId", employeeId);
    return apiRequest<{ runs: Run[] }>(token, `/api/runs?${qs.toString()}`);
  },
  createRun: (token: string, input: CreateRunInput) =>
    apiRequest<{ run: Run }>(token, "/api/runs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRun: (token: string, runId: string) =>
    apiRequest<{ run: Run }>(token, `/api/runs/${encodeURIComponent(runId)}`),
  getRunEvents: (token: string, runId: string, afterSeq = 0) =>
    apiRequest<{ runId: string; status: string; events: StoredRunEvent[] }>(
      token,
      `/api/runs/${encodeURIComponent(runId)}/events?afterSeq=${afterSeq}`,
    ),
  cancelRun: (token: string, runId: string) =>
    apiRequest<{ ok: boolean; run: Run | null }>(
      token,
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  getApprovals: (token: string, status?: ApprovalStatus) =>
    apiRequest<{ approvals: ApprovalRequest[] }>(
      token,
      status ? `/api/approvals?status=${status}` : "/api/approvals",
    ),
  decideApproval: (token: string, id: string, input: ApprovalDecisionInput) =>
    apiRequest<{ status: string; reason?: string; approval: ApprovalRequest }>(
      token,
      `/api/approvals/${encodeURIComponent(id)}/decide`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  searchMemory: (
    token: string,
    q: string,
    opts?: {
      scope?: MemoryScope;
      projectId?: string;
      status?: MemoryStatus;
      memoryType?: MemoryType;
      includeArchived?: boolean;
    },
  ) => {
    const qs = new URLSearchParams({ q, limit: "30" });
    if (opts?.scope) qs.set("scope", opts.scope);
    if (opts?.projectId) qs.set("projectId", opts.projectId);
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.memoryType) qs.set("memoryType", opts.memoryType);
    if (opts?.includeArchived) qs.set("includeArchived", "true");
    return apiRequest<{ entries: MemoryEntry[]; meta: MemorySearchMeta }>(
      token,
      `/api/memory/search?${qs.toString()}`,
    );
  },
  createMemoryNote: (token: string, input: CreateMemoryNoteInput) =>
    apiRequest<{
      entry: MemoryEntry;
      conflictDetected: boolean;
      conflictingEntry: MemoryEntry | null;
    }>(token, "/api/memory/notes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  promoteMemoryNote: (token: string, id: string, input: PromoteMemoryInput) =>
    apiRequest<{
      entry: MemoryEntry;
      conflictDetected: boolean;
      conflictingEntry: MemoryEntry | null;
    }>(token, `/api/memory/${encodeURIComponent(id)}/promote`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getMemoryConflicts: (token: string) =>
    apiRequest<{ conflicts: MemoryConflictItem[] }>(token, "/api/memory/conflicts"),
  resolveMemoryConflict: (token: string, id: string, input: ResolveConflictInput) =>
    apiRequest<{ resolvedEntry: MemoryEntry; supersededEntry: MemoryEntry | null }>(
      token,
      `/api/memory/conflicts/${encodeURIComponent(id)}/resolve`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  recalculateMemoryDecay: (token: string) =>
    apiRequest<{ updated: number }>(token, "/api/memory/recalculate-decay", {
      method: "POST",
    }),
  getVectorStatus: (token: string) =>
    apiRequest<{ vectorStatus: VectorStatus }>(token, "/api/memory/vectors/status"),
  syncVectors: (token: string) =>
    apiRequest<{
      result: { embedded: number; skipped: number; failed: number; error?: string };
      vectorStatus: VectorStatus;
    }>(token, "/api/memory/vectors/sync", { method: "POST" }),
  getLearningProposals: (
    token: string,
    filter?: { status?: LearningProposalStatus; employeeId?: string },
  ) => {
    const qs = new URLSearchParams();
    if (filter?.status) qs.set("status", filter.status);
    if (filter?.employeeId) qs.set("employeeId", filter.employeeId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiRequest<{ proposals: LearningProposal[] }>(
      token,
      `/api/learning/proposals${suffix}`,
    );
  },
  submitLearningFeedback: (token: string, input: SubmitFeedbackInput) =>
    apiRequest<{ proposal: LearningProposal; approval: ApprovalRequest | null }>(
      token,
      "/api/learning/feedback",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  rollbackLearningProposal: (
    token: string,
    id: string,
    input?: RollbackProposalInput,
  ) =>
    apiRequest<{ proposal: LearningProposal }>(
      token,
      `/api/learning/proposals/${encodeURIComponent(id)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      },
    ),
  getAuditLogs: (token: string, limit = 100) =>
    apiRequest<{ logs: AuditLogEntry[] }>(token, `/api/audit?limit=${limit}`),
  getUsage: (token: string) => apiRequest<{ usage: UsageSummary }>(token, "/api/usage"),
  getVaultKeys: (token: string) =>
    apiRequest<{ keys: VaultKeySummary[] }>(token, "/api/vault/keys"),
  saveVaultKey: (
    token: string,
    key: string,
    value: string,
    providerHint?: string,
  ) =>
    apiRequest<{ key: VaultKeySummary }>(
      token,
      `/api/vault/keys/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ value, providerHint }),
      },
    ),
  deleteVaultKey: (token: string, key: string) =>
    apiRequest<{ ok: boolean }>(
      token,
      `/api/vault/keys/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),
  getMcpServers: (token: string) =>
    apiRequest<{ servers: McpServerConfig[] }>(token, "/api/mcps"),
  getMcpTemplates: (token: string) =>
    apiRequest<{ templates: McpTemplate[] }>(token, "/api/mcps/templates"),
  upsertMcpServer: (token: string, config: McpServerConfigInput) =>
    apiRequest<{ server: McpServerConfig }>(token, "/api/mcps", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  patchMcpServer: (
    token: string,
    id: string,
    patch: Partial<McpServerConfigInput>,
  ) =>
    apiRequest<{ server: McpServerConfig }>(
      token,
      `/api/mcps/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    ),
  deleteMcpServer: (token: string, id: string) =>
    apiRequest<{ ok: boolean }>(token, `/api/mcps/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  testMcpServer: (token: string, id: string) =>
    apiRequest<{ result: McpTestResult }>(
      token,
      `/api/mcps/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  getCompanyPolicies: (token: string) =>
    apiRequest<CompanyPoliciesResponse>(token, "/api/company/policies"),
  patchCompanyPolicies: (
    token: string,
    patch: {
      budgets?: Partial<BudgetPolicy>;
      security?: Partial<BrowserSecurityPolicy>;
      memory?: Partial<MemoryPolicy>;
      telegram?: Partial<TelegramPolicy>;
    },
  ) =>
    apiRequest<CompanyPoliciesResponse>(token, "/api/company/policies", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  getTaskPlans: (token: string) =>
    apiRequest<{ plans: TaskPlan[] }>(token, "/api/plans"),
  createTaskPlan: (token: string, input: CreateTaskPlanInput) =>
    apiRequest<{ plan: TaskPlan }>(token, "/api/plans", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  startTaskPlan: (token: string, id: string) =>
    apiRequest<{ plan: TaskPlan }>(token, `/api/plans/${encodeURIComponent(id)}/start`, {
      method: "POST",
    }),
  cancelTaskPlan: (token: string, id: string) =>
    apiRequest<{ plan: TaskPlan }>(token, `/api/plans/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  getMeetings: (token: string) =>
    apiRequest<{ meetings: MeetingRecord[] }>(token, "/api/meetings"),
  createMeeting: (token: string, input: CreateMeetingInput) =>
    apiRequest<{ meeting: MeetingRecord }>(token, "/api/meetings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancelMeeting: (token: string, id: string) =>
    apiRequest<{ meeting: MeetingRecord }>(
      token,
      `/api/meetings/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
  getHiringTemplates: (token: string) =>
    apiRequest<{ templates: HiringRoleTemplate[] }>(token, "/api/hiring/templates"),
  getHiringProposals: (token: string, status?: HiringProposalStatus) =>
    apiRequest<{ proposals: HiringProposal[] }>(
      token,
      status ? `/api/hiring/proposals?status=${status}` : "/api/hiring/proposals",
    ),
  createHiringProposal: (token: string, input: CreateHiringProposalInput) =>
    apiRequest<{ proposal: HiringProposal; approval: ApprovalRequest | null }>(
      token,
      "/api/hiring/proposals",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  rollbackHiringProposal: (token: string, id: string, reason?: string) =>
    apiRequest<{ proposal: HiringProposal }>(
      token,
      `/api/hiring/proposals/${encodeURIComponent(id)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    ),
  getSchedules: (token: string) =>
    apiRequest<{
      jobs: ScheduledJob[];
      presets: CronPreset[];
      recentRuns: ScheduledJobRunRecord[];
    }>(token, "/api/schedules"),
  createSchedule: (token: string, input: CreateScheduledJobInput) =>
    apiRequest<{ job: ScheduledJob }>(token, "/api/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSchedule: (token: string, id: string, patch: UpdateScheduledJobInput) =>
    apiRequest<{ job: ScheduledJob }>(token, `/api/schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteSchedule: (token: string, id: string) =>
    apiRequest<{ ok: boolean }>(token, `/api/schedules/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  runScheduleNow: (token: string, id: string) =>
    apiRequest<{ triggered: boolean; reason?: string; job: ScheduledJob | null; runId?: string }>(
      token,
      `/api/schedules/${encodeURIComponent(id)}/run`,
      { method: "POST" },
    ),
  getTelegramStatus: (token: string) =>
    apiRequest<{
      status: TelegramStatus;
      policy: TelegramPolicy;
      messages: TelegramMessageRecord[];
    }>(token, "/api/telegram/status"),
  testTelegramBot: (token: string) =>
    apiRequest<{
      result: { ok: boolean; botUsername?: string; error?: string };
      status: TelegramStatus;
    }>(token, "/api/telegram/test", { method: "POST" }),
  simulateTelegramUpdate: (
    token: string,
    input: { chatId: string; text?: string; callbackData?: string; mode?: RunMode },
  ) =>
    apiRequest<{
      accepted: boolean;
      reply?: string;
      error?: string;
      status: TelegramStatus;
      messages: TelegramMessageRecord[];
    }>(token, "/api/telegram/simulate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateFloorplanLayout: (token: string, input: UpdateFloorplanLayoutInput) =>
    apiRequest<{ company: CompanyConfig }>(token, "/api/company/floorplan", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  getAnalytics: (token: string, days = 14) =>
    apiRequest<{ analytics: AnalyticsSummary }>(
      token,
      `/api/analytics?days=${encodeURIComponent(String(days))}`,
    ),
  getFilteredAuditLogs: (
    token: string,
    opts?: { limit?: number; actorType?: string; status?: string; q?: string },
  ) => {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 150));
    if (opts?.actorType) params.set("actorType", opts.actorType);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.q) params.set("q", opts.q);
    return apiRequest<{ logs: AuditLogEntry[] }>(token, `/api/audit?${params.toString()}`);
  },
  downloadAuditCsv: (
    token: string,
    opts?: { limit?: number; actorType?: string; status?: string; q?: string },
  ) => {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 500));
    params.set("format", "csv");
    if (opts?.actorType) params.set("actorType", opts.actorType);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.q) params.set("q", opts.q);
    return downloadAuthorizedFile(
      token,
      `/api/audit?${params.toString()}`,
      "virtual-office-audit.csv",
    );
  },
  getBackupStatus: (token: string) =>
    apiRequest<{ status: GitBackupStatus }>(token, "/api/backup/status"),
  initBackupRepo: (token: string) =>
    apiRequest<{ status: GitBackupStatus }>(token, "/api/backup/init", { method: "POST" }),
  createBackupSnapshot: (token: string, message?: string) =>
    apiRequest<{ created: boolean; commitHash: string | null; status: GitBackupStatus }>(
      token,
      "/api/backup/snapshot",
      {
        method: "POST",
        body: JSON.stringify(message ? { message } : {}),
      },
    ),
  getBackupDiff: (token: string, commit?: string) =>
    apiRequest<{ diff: string }>(
      token,
      commit ? `/api/backup/diff?commit=${encodeURIComponent(commit)}` : "/api/backup/diff",
    ),
  restoreBackupSnapshot: (token: string, commitHash: string) =>
    apiRequest<{
      restoredFrom: string;
      preRestoreCommitHash: string | null;
      newCommitHash: string | null;
      status: GitBackupStatus;
    }>(token, "/api/backup/restore", {
      method: "POST",
      body: JSON.stringify({ commitHash }),
    }),
  downloadBackupExport: (token: string) =>
    downloadAuthorizedFile(token, "/api/backup/export", "company-export.json"),
};
