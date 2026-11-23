import { create } from "zustand";
import type {
  AnalyticsSummary,
  ApprovalDecisionInput,
  ApprovalRequest,
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
  HiringRoleTemplate,
  LearningProposal,
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
import type { Locale } from "../i18n/translations.ts";
import {
  ApiError,
  fetchLocalSession,
  officeApi,
  type AuditLogEntry,
  type CompanyPoliciesResponse,
  type ConversationRecord,
  type McpTemplate,
  type McpTestResult,
  type MemoryConflictItem,
  type MessageRecord,
  type StoredRunEvent,
  type UsageSummary,
} from "../lib/api.ts";
import { OfficeWsClient, type WsConnectionStatus, type WsIncomingMessage } from "../lib/ws-client.ts";

export type AppView =
  | "office"
  | "orchestration"
  | "hiring"
  | "automation"
  | "approvals"
  | "projects"
  | "memory"
  | "mcps"
  | "providers"
  | "audit";

export type EmployeeLiveStatus =
  | "working"
  | "queued"
  | "waiting_approval"
  | "failed"
  | "idle";

export type UiTheme = "dark" | "light";
export type OfficeViewMode = "2d" | "3d_orbit" | "3d_fp";
export type AmbientLifeMode = "quiet" | "balanced" | "lively";
export type QualityTier3D = "high" | "balanced" | "eco";
export type LightingMode3D = "day" | "night";
export type AvatarRendererMode3D = "hybrid" | "rigged_all" | "procedural";

export interface OfficeNotification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  titleAr: string;
  detail?: string;
  targetView?: AppView;
  employeeId?: string;
  read: boolean;
  createdAt: string;
}

export interface OfficeState {
  locale: Locale;
  uiTheme: UiTheme;
  reducedMotion: boolean;
  officeViewMode: OfficeViewMode;
  ambientLifeMode: AmbientLifeMode;
  qualityTier3D: QualityTier3D;
  lightingMode3D: LightingMode3D;
  avatarRendererMode: AvatarRendererMode3D;
  activeView: AppView;
  commandPaletteOpen: boolean;
  registerModalOpen: boolean;
  notifications: OfficeNotification[];
  toasts: OfficeNotification[];
  selectedEmployeeId: string | null;
  selectedConversationIdByEmployee: Record<string, string | null>;
  activeProjectId: string | null;
  runMode: RunMode;

  token: string | null;
  loading: boolean;
  connectionError: string | null;
  wsStatus: WsConnectionStatus;

  company: CompanyConfig | null;
  employees: LoadedEmployee[];
  projects: Project[];
  tasks: Task[];
  runs: Run[];
  approvals: ApprovalRequest[];
  providers: ProviderHealth[];
  usage: UsageSummary | null;
  auditLogs: AuditLogEntry[];
  memoryResults: MemoryEntry[];
  memorySearchMeta: MemorySearchMeta | null;
  memoryConflicts: MemoryConflictItem[];
  learningProposals: LearningProposal[];
  vectorStatus: VectorStatus | null;
  vaultKeys: VaultKeySummary[];
  mcpServers: McpServerConfig[];
  mcpTemplates: McpTemplate[];
  companyPolicies: CompanyPoliciesResponse | null;
  taskPlans: TaskPlan[];
  meetings: MeetingRecord[];
  hiringProposals: HiringProposal[];
  hiringTemplates: HiringRoleTemplate[];
  scheduledJobs: ScheduledJob[];
  scheduledJobRuns: ScheduledJobRunRecord[];
  cronPresets: CronPreset[];
  telegramStatus: TelegramStatus | null;
  telegramMessages: TelegramMessageRecord[];
  analytics: AnalyticsSummary | null;
  backupStatus: GitBackupStatus | null;
  backupDiff: string;

  conversationsByEmployee: Record<string, ConversationRecord[]>;
  messagesByConversationId: Record<string, MessageRecord[]>;
  eventsByRunId: Record<string, StoredRunEvent[]>;
  liveDeltaByRunId: Record<string, string>;
  lastGlobalSeq: number;

  setLocale: (locale: Locale) => void;
  setUiTheme: (theme: UiTheme) => void;
  toggleUiTheme: () => void;
  setReducedMotion: (reduced: boolean) => void;
  setOfficeViewMode: (mode: OfficeViewMode) => void;
  setAmbientLifeMode: (mode: AmbientLifeMode) => void;
  setQualityTier3D: (tier: QualityTier3D) => void;
  setLightingMode3D: (mode: LightingMode3D) => void;
  setAvatarRendererMode: (mode: AvatarRendererMode3D) => void;
  setActiveView: (view: AppView) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setRegisterModalOpen: (open: boolean) => void;
  pushNotification: (
    n: Omit<OfficeNotification, "id" | "read" | "createdAt">,
  ) => void;
  dismissToast: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  setActiveProjectId: (projectId: string | null) => void;
  setRunMode: (mode: RunMode) => void;
  selectEmployee: (employeeId: string | null) => Promise<void>;
  selectConversation: (employeeId: string, conversationId: string | null) => Promise<void>;

  bootstrap: () => Promise<void>;
  refreshOperationalData: () => Promise<void>;
  startRun: (input: CreateRunInput) => Promise<Run>;
  cancelRun: (runId: string) => Promise<void>;
  decideApproval: (
    id: string,
    decision: ApprovalDecisionInput,
  ) => Promise<{ ok: boolean; status: string; reason?: string }>;
  registerProject: (input: RegisterProjectInput) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<void>;
  searchMemory: (
    q: string,
    opts?: {
      scope?: MemoryScope;
      projectId?: string;
      status?: MemoryStatus;
      memoryType?: MemoryType;
      includeArchived?: boolean;
    },
  ) => Promise<void>;
  createMemoryNote: (input: CreateMemoryNoteInput) => Promise<{
    entry: MemoryEntry;
    conflictDetected: boolean;
    conflictingEntry: MemoryEntry | null;
  }>;
  promoteMemoryNote: (
    id: string,
    input: PromoteMemoryInput,
  ) => Promise<{ entry: MemoryEntry; conflictDetected: boolean }>;
  loadMemoryGovernance: () => Promise<void>;
  resolveMemoryConflict: (id: string, input: ResolveConflictInput) => Promise<void>;
  recalculateMemoryDecay: () => Promise<{ updated: number }>;
  syncVectors: () => Promise<{ embedded: number; skipped: number; failed: number; error?: string }>;
  submitLearningFeedback: (
    input: SubmitFeedbackInput,
  ) => Promise<{ proposal: LearningProposal; approval: ApprovalRequest | null }>;
  rollbackLearningProposal: (
    id: string,
    input?: RollbackProposalInput,
  ) => Promise<LearningProposal>;
  summarizeConversation: (conversationId: string) => Promise<void>;
  refreshProviders: () => Promise<void>;
  loadAuditAndUsage: () => Promise<void>;
  loadVaultAndPolicies: () => Promise<void>;
  saveVaultKey: (key: string, value: string, providerHint?: string) => Promise<void>;
  deleteVaultKey: (key: string) => Promise<void>;
  loadMcps: () => Promise<void>;
  upsertMcp: (config: McpServerConfigInput) => Promise<McpServerConfig>;
  patchMcp: (id: string, patch: Partial<McpServerConfigInput>) => Promise<void>;
  deleteMcp: (id: string) => Promise<void>;
  testMcp: (id: string) => Promise<McpTestResult>;
  updatePolicies: (patch: {
    budgets?: Partial<BudgetPolicy>;
    security?: Partial<BrowserSecurityPolicy>;
    memory?: Partial<MemoryPolicy>;
    telegram?: Partial<TelegramPolicy>;
  }) => Promise<void>;
  loadOrchestrationAndHiring: () => Promise<void>;
  createTaskPlan: (input: CreateTaskPlanInput) => Promise<TaskPlan>;
  startTaskPlan: (id: string) => Promise<void>;
  cancelTaskPlan: (id: string) => Promise<void>;
  createMeeting: (input: CreateMeetingInput) => Promise<MeetingRecord>;
  cancelMeeting: (id: string) => Promise<void>;
  createHiringProposal: (
    input: CreateHiringProposalInput,
  ) => Promise<{ proposal: HiringProposal; approval: ApprovalRequest | null }>;
  rollbackHiringProposal: (id: string, reason?: string) => Promise<void>;
  loadAutomation: () => Promise<void>;
  createScheduledJob: (input: CreateScheduledJobInput) => Promise<ScheduledJob>;
  updateScheduledJob: (id: string, patch: UpdateScheduledJobInput) => Promise<void>;
  deleteScheduledJob: (id: string) => Promise<void>;
  runScheduledJobNow: (id: string) => Promise<{ triggered: boolean; reason?: string }>;
  testTelegramBot: () => Promise<{ ok: boolean; botUsername?: string; error?: string }>;
  simulateTelegramUpdate: (input: {
    chatId: string;
    text?: string;
    callbackData?: string;
    mode?: RunMode;
  }) => Promise<{ accepted: boolean; reply?: string; error?: string }>;
  saveFloorplanLayout: (input: UpdateFloorplanLayoutInput) => Promise<CompanyConfig>;
  loadAnalytics: (days?: number) => Promise<void>;
  loadFilteredAudit: (opts?: {
    limit?: number;
    actorType?: string;
    status?: string;
    q?: string;
  }) => Promise<void>;
  loadBackupStatus: () => Promise<void>;
  initBackupRepo: () => Promise<void>;
  createBackupSnapshot: (message?: string) => Promise<{ created: boolean }>;
  loadBackupDiff: (commitHash?: string) => Promise<void>;
  restoreBackupSnapshot: (commitHash: string) => Promise<void>;
  handleWsMessage: (msg: WsIncomingMessage) => void;
}

let wsClient: OfficeWsClient | null = null;

function applyLocaleToDom(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

function readInitialUiTheme(): UiTheme {
  try {
    const saved = localStorage.getItem("vo.uiTheme");
    return saved === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readInitialReducedMotion(): boolean {
  try {
    const saved = localStorage.getItem("vo.reducedMotion");
    if (saved === "true") return true;
    if (saved === "false") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}

function applyThemeToDom(theme: UiTheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

function applyReducedMotionToDom(reduced: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.reducedMotion = reduced ? "true" : "false";
  }
}

function readSavedEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return val && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;
  } catch {
    return fallback;
  }
}

const initialUiTheme = readInitialUiTheme();
const initialReducedMotion = readInitialReducedMotion();
const initialOfficeViewMode = readSavedEnum<OfficeViewMode>(
  "vo.officeViewMode",
  ["2d", "3d_orbit", "3d_fp"],
  "2d",
);
const initialAmbientLifeMode = readSavedEnum<AmbientLifeMode>(
  "vo.ambientLifeMode",
  ["quiet", "balanced", "lively"],
  "balanced",
);
const initialQualityTier3D = readSavedEnum<QualityTier3D>(
  "vo.qualityTier3D",
  ["high", "balanced", "eco"],
  "high",
);
const initialLightingMode3D = readSavedEnum<LightingMode3D>(
  "vo.lightingMode3D",
  ["day", "night"],
  "night",
);
const initialAvatarRendererMode = readSavedEnum<AvatarRendererMode3D>(
  "vo.avatarRendererMode",
  ["hybrid", "rigged_all", "procedural"],
  "hybrid",
);
applyThemeToDom(initialUiTheme);
applyReducedMotionToDom(initialReducedMotion);

function appendRunEventDedup(
  existing: StoredRunEvent[] | undefined,
  incoming: StoredRunEvent,
): StoredRunEvent[] {
  const list = existing ? [...existing] : [];
  if (incoming.seq > 0 && list.some((e) => e.seq === incoming.seq)) {
    return list;
  }
  list.push(incoming);
  return list;
}

export const useOfficeStore = create<OfficeState>((set, get) => ({
  locale: "ar",
  uiTheme: initialUiTheme,
  reducedMotion: initialReducedMotion,
  officeViewMode: initialOfficeViewMode,
  ambientLifeMode: initialAmbientLifeMode,
  qualityTier3D: initialQualityTier3D,
  lightingMode3D: initialLightingMode3D,
  avatarRendererMode: initialAvatarRendererMode,
  activeView: "office",
  commandPaletteOpen: false,
  registerModalOpen: false,
  notifications: [],
  toasts: [],
  selectedEmployeeId: null,
  selectedConversationIdByEmployee: {},
  activeProjectId: null,
  runMode: "live",

  token: null,
  loading: true,
  connectionError: null,
  wsStatus: "disconnected",

  company: null,
  employees: [],
  projects: [],
  tasks: [],
  runs: [],
  approvals: [],
  providers: [],
  usage: null,
  auditLogs: [],
  memoryResults: [],
  memorySearchMeta: null,
  memoryConflicts: [],
  learningProposals: [],
  vectorStatus: null,
  vaultKeys: [],
  mcpServers: [],
  mcpTemplates: [],
  companyPolicies: null,
  taskPlans: [],
  meetings: [],
  hiringProposals: [],
  hiringTemplates: [],
  scheduledJobs: [],
  scheduledJobRuns: [],
  cronPresets: [],
  telegramStatus: null,
  telegramMessages: [],
  analytics: null,
  backupStatus: null,
  backupDiff: "",

  conversationsByEmployee: {},
  messagesByConversationId: {},
  eventsByRunId: {},
  liveDeltaByRunId: {},
  lastGlobalSeq: 0,

  setLocale: (locale) => {
    applyLocaleToDom(locale);
    set({ locale });
  },

  setUiTheme: (uiTheme) => {
    applyThemeToDom(uiTheme);
    try {
      localStorage.setItem("vo.uiTheme", uiTheme);
    } catch {
      // Ignore storage failures
    }
    set({ uiTheme });
  },

  toggleUiTheme: () => {
    const next: UiTheme = get().uiTheme === "dark" ? "light" : "dark";
    get().setUiTheme(next);
  },

  setReducedMotion: (reducedMotion) => {
    applyReducedMotionToDom(reducedMotion);
    try {
      localStorage.setItem("vo.reducedMotion", reducedMotion ? "true" : "false");
    } catch {
      // Ignore
    }
    set({ reducedMotion });
  },

  setOfficeViewMode: (officeViewMode) => {
    try {
      localStorage.setItem("vo.officeViewMode", officeViewMode);
    } catch {
      // Ignore
    }
    set({ officeViewMode });
  },

  setAmbientLifeMode: (ambientLifeMode) => {
    try {
      localStorage.setItem("vo.ambientLifeMode", ambientLifeMode);
    } catch {
      // Ignore
    }
    set({ ambientLifeMode });
  },

  setQualityTier3D: (qualityTier3D) => {
    try {
      localStorage.setItem("vo.qualityTier3D", qualityTier3D);
    } catch {
      // Ignore
    }
    set({ qualityTier3D });
  },

  setLightingMode3D: (lightingMode3D) => {
    try {
      localStorage.setItem("vo.lightingMode3D", lightingMode3D);
    } catch {
      // Ignore
    }
    set({ lightingMode3D });
  },

  setAvatarRendererMode: (avatarRendererMode) => {
    try {
      localStorage.setItem("vo.avatarRendererMode", avatarRendererMode);
    } catch {
      // Ignore
    }
    set({ avatarRendererMode });
  },

  setActiveView: (activeView) => set({ activeView }),

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  setRegisterModalOpen: (registerModalOpen) => set({ registerModalOpen }),

  pushNotification: (n) => {
    const entry: OfficeNotification = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      read: false,
      createdAt: new Date().toISOString(),
      ...n,
    };
    set((state) => ({
      notifications: [entry, ...state.notifications].slice(0, 40),
      toasts: [entry, ...state.toasts].slice(0, 4),
    }));
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearNotifications: () => set({ notifications: [], toasts: [] }),

  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),

  setRunMode: (runMode) => set({ runMode }),

  selectEmployee: async (employeeId) => {
    set({ selectedEmployeeId: employeeId });
    if (!employeeId) {
      return;
    }
    const token = get().token;
    if (!token) {
      return;
    }

    try {
      const detail = await officeApi.getEmployeeDetail(token, employeeId);
      const currentSelected = get().selectedConversationIdByEmployee[employeeId];
      const nextConvId =
        currentSelected !== undefined
          ? currentSelected
          : (detail.conversations[0]?.id ?? null);

      set((state) => ({
        conversationsByEmployee: {
          ...state.conversationsByEmployee,
          [employeeId]: detail.conversations,
        },
        selectedConversationIdByEmployee: {
          ...state.selectedConversationIdByEmployee,
          [employeeId]: nextConvId,
        },
      }));

      if (nextConvId) {
        const msgData = await officeApi.getConversationMessages(token, nextConvId);
        set((state) => ({
          conversationsByEmployee: {
            ...state.conversationsByEmployee,
            [employeeId]: (state.conversationsByEmployee[employeeId] ?? []).map((c) =>
              c.id === nextConvId ? msgData.conversation : c,
            ),
          },
          messagesByConversationId: {
            ...state.messagesByConversationId,
            [nextConvId]: msgData.messages,
          },
        }));
      }

      // Hydrate traces for recent runs of this employee
      const empRuns = get()
        .runs.filter((r) => r.employeeId === employeeId)
        .slice(0, 5);
      for (const r of empRuns) {
        if (!get().eventsByRunId[r.id]) {
          const evResp = await officeApi.getRunEvents(token, r.id, 0);
          set((state) => ({
            eventsByRunId: {
              ...state.eventsByRunId,
              [r.id]: evResp.events,
            },
          }));
        }
      }
    } catch {
      // Non-fatal hydration issue
    }
  },

  selectConversation: async (employeeId, conversationId) => {
    set((state) => ({
      selectedConversationIdByEmployee: {
        ...state.selectedConversationIdByEmployee,
        [employeeId]: conversationId,
      },
    }));
    const token = get().token;
    if (!token || !conversationId) {
      return;
    }
    const msgData = await officeApi.getConversationMessages(token, conversationId);
    set((state) => ({
      conversationsByEmployee: {
        ...state.conversationsByEmployee,
        [employeeId]: (state.conversationsByEmployee[employeeId] ?? []).map((c) =>
          c.id === conversationId ? msgData.conversation : c,
        ),
      },
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: msgData.messages,
      },
    }));
  },

  bootstrap: async () => {
    applyLocaleToDom(get().locale);
    set({ loading: true, connectionError: null });
    try {
      const session = await fetchLocalSession();
      const token = session.token;

      const [
        boot,
        empRes,
        tasksRes,
        runsRes,
        approvalsRes,
        usageRes,
        memRes,
        conflictsRes,
        learningRes,
        vecRes,
        polRes,
        plansRes,
        meetingsRes,
        hirePropsRes,
        hireTplsRes,
        vaultRes,
        backupRes,
      ] = await Promise.all([
        officeApi.getBootstrap(token),
        officeApi.getEmployees(token),
        officeApi.getTasks(token),
        officeApi.getRuns(token, undefined, 60),
        officeApi.getApprovals(token),
        officeApi.getUsage(token),
        officeApi.searchMemory(token, ""),
        officeApi.getMemoryConflicts(token),
        officeApi.getLearningProposals(token),
        officeApi.getVectorStatus(token),
        officeApi.getCompanyPolicies(token),
        officeApi.getTaskPlans(token),
        officeApi.getMeetings(token),
        officeApi.getHiringProposals(token),
        officeApi.getHiringTemplates(token),
        officeApi.getVaultKeys(token).catch(() => ({ keys: [] })),
        officeApi.getBackupStatus(token).catch(() => ({ status: null })),
      ]);

      const providers =
        boot.providers.length > 0
          ? boot.providers
          : (await officeApi.getProviders(token)).providers;

      set({
        token,
        loading: false,
        connectionError: null,
        company: boot.company,
        employees: empRes.employees,
        projects: boot.projects,
        tasks: tasksRes.tasks,
        runs: runsRes.runs,
        approvals: approvalsRes.approvals,
        providers,
        usage: usageRes.usage,
        memoryResults: memRes.entries,
        memorySearchMeta: memRes.meta,
        memoryConflicts: conflictsRes.conflicts,
        learningProposals: learningRes.proposals,
        vectorStatus: vecRes.vectorStatus,
        companyPolicies: polRes,
        taskPlans: plansRes.plans,
        meetings: meetingsRes.meetings,
        hiringProposals: hirePropsRes.proposals,
        hiringTemplates: hireTplsRes.templates,
        vaultKeys: vaultRes.keys,
        backupStatus: backupRes.status,
      });

      if (!wsClient) {
        wsClient = new OfficeWsClient({
          getAfterSeq: () => get().lastGlobalSeq,
          onMessage: (msg) => get().handleWsMessage(msg),
          onStatus: (wsStatus) => set({ wsStatus }),
        });
      }
      wsClient.connect(token);
    } catch (err) {
      set({
        loading: false,
        connectionError: err instanceof Error ? err.message : "Failed to connect",
      });
    }
  },

  refreshOperationalData: async () => {
    const token = get().token;
    if (!token) return;
    const [runsRes, approvalsRes, usageRes, tasksRes, projRes] = await Promise.all([
      officeApi.getRuns(token, undefined, 60),
      officeApi.getApprovals(token),
      officeApi.getUsage(token),
      officeApi.getTasks(token),
      officeApi.getProjects(token),
    ]);
    set({
      runs: runsRes.runs,
      approvals: approvalsRes.approvals,
      usage: usageRes.usage,
      tasks: tasksRes.tasks,
      projects: projRes.projects,
    });
  },

  startRun: async (input) => {
    const token = get().token;
    if (!token) {
      throw new Error("Not authenticated");
    }

    let run: Run;
    try {
      const resp = await officeApi.createRun(token, input);
      run = resp.run;
    } catch (err) {
      // Handle HTTP 402 pre-flight budget exceeded returned with `{ run }`
      if (err instanceof ApiError && err.status === 402 && typeof err.data === "object" && err.data && "run" in err.data) {
        run = (err.data as { run: Run }).run;
      } else {
        throw err;
      }
    }

    set((state) => {
      const existing = state.runs.find((r) => r.id === run.id);
      // Do not overwrite a newer WebSocket run_status (e.g., RUNNING/FAILED/COMPLETED) with stale QUEUED HTTP response
      if (existing && run.status === "QUEUED" && existing.status !== "QUEUED") {
        return {
          selectedConversationIdByEmployee: {
            ...state.selectedConversationIdByEmployee,
            [run.employeeId]: run.conversationId,
          },
        };
      }
      return {
        runs: [run, ...state.runs.filter((r) => r.id !== run.id)],
        selectedConversationIdByEmployee: {
          ...state.selectedConversationIdByEmployee,
          [run.employeeId]: run.conversationId,
        },
      };
    });

    // Refresh conversation list and messages so the user's message renders immediately
    const [detail, msgData] = await Promise.all([
      officeApi.getEmployeeDetail(token, run.employeeId),
      officeApi.getConversationMessages(token, run.conversationId),
    ]);
    set((state) => ({
      conversationsByEmployee: {
        ...state.conversationsByEmployee,
        [run.employeeId]: detail.conversations,
      },
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [run.conversationId]: msgData.messages,
      },
    }));

    return run;
  },

  cancelRun: async (runId) => {
    const token = get().token;
    if (!token) return;
    const res = await officeApi.cancelRun(token, runId);
    if (res.run) {
      set((state) => ({
        runs: state.runs.map((r) => (r.id === runId ? res.run! : r)),
      }));
    }
  },

  decideApproval: async (id, decision) => {
    const token = get().token;
    if (!token) return { ok: false, status: "UNAUTHORIZED" };
    try {
      const res = await officeApi.decideApproval(token, id, decision);
      await Promise.all([
        get().refreshOperationalData(),
        get().loadMemoryGovernance(),
        get().loadOrchestrationAndHiring(),
        officeApi.getBootstrap(token).then((b) => set({ company: b.company })),
        officeApi.getEmployees(token).then((r) => set({ employees: r.employees })),
        officeApi.searchMemory(token, "").then((r) =>
          set({ memoryResults: r.entries, memorySearchMeta: r.meta }),
        ),
      ]);
      return { ok: true, status: res.status, reason: res.reason };
    } catch (err) {
      if (err instanceof ApiError && typeof err.data === "object" && err.data) {
        const d = err.data as { status?: string; reason?: string };
        await get().refreshOperationalData();
        return { ok: false, status: d.status ?? "ERROR", reason: d.reason ?? err.message };
      }
      throw err;
    }
  },

  registerProject: async (input) => {
    const token = get().token!;
    const { project } = await officeApi.registerProject(token, input);
    set((state) => ({
      projects: [...state.projects.filter((p) => p.id !== project.id), project],
      activeProjectId: project.id,
    }));
    return project;
  },

  removeProject: async (id) => {
    const token = get().token!;
    await officeApi.deleteProject(token, id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    }));
  },

  createTask: async (input) => {
    const token = get().token!;
    const { task } = await officeApi.createTask(token, input);
    set((state) => ({ tasks: [task, ...state.tasks] }));
    return task;
  },

  updateTaskStatus: async (id, status) => {
    const token = get().token!;
    const { task } = await officeApi.patchTask(token, id, { status });
    set((state) => ({
      tasks: state.tasks.map((item) => (item.id === id ? task : item)),
    }));
  },

  searchMemory: async (q, opts) => {
    const token = get().token;
    if (!token) return;
    const { entries, meta } = await officeApi.searchMemory(token, q, opts);
    set({ memoryResults: entries, memorySearchMeta: meta });
  },

  createMemoryNote: async (input) => {
    const token = get().token!;
    const res = await officeApi.createMemoryNote(token, input);
    const [memRes, conflictsRes, vecRes] = await Promise.all([
      officeApi.searchMemory(token, ""),
      officeApi.getMemoryConflicts(token),
      officeApi.getVectorStatus(token),
    ]);
    set({
      memoryResults: memRes.entries,
      memorySearchMeta: memRes.meta,
      memoryConflicts: conflictsRes.conflicts,
      vectorStatus: vecRes.vectorStatus,
    });
    return res;
  },

  promoteMemoryNote: async (id, input) => {
    const token = get().token!;
    const res = await officeApi.promoteMemoryNote(token, id, input);
    const [memRes, conflictsRes, vecRes] = await Promise.all([
      officeApi.searchMemory(token, ""),
      officeApi.getMemoryConflicts(token),
      officeApi.getVectorStatus(token),
    ]);
    set({
      memoryResults: memRes.entries,
      memorySearchMeta: memRes.meta,
      memoryConflicts: conflictsRes.conflicts,
      vectorStatus: vecRes.vectorStatus,
    });
    return res;
  },

  loadMemoryGovernance: async () => {
    const token = get().token;
    if (!token) return;
    const [conflictsRes, learningRes, vecRes, polRes] = await Promise.all([
      officeApi.getMemoryConflicts(token),
      officeApi.getLearningProposals(token),
      officeApi.getVectorStatus(token),
      officeApi.getCompanyPolicies(token),
    ]);
    set({
      memoryConflicts: conflictsRes.conflicts,
      learningProposals: learningRes.proposals,
      vectorStatus: vecRes.vectorStatus,
      companyPolicies: polRes,
    });
  },

  resolveMemoryConflict: async (id, input) => {
    const token = get().token!;
    await officeApi.resolveMemoryConflict(token, id, input);
    const [conflictsRes, memRes, vecRes] = await Promise.all([
      officeApi.getMemoryConflicts(token),
      officeApi.searchMemory(token, ""),
      officeApi.getVectorStatus(token),
    ]);
    set({
      memoryConflicts: conflictsRes.conflicts,
      memoryResults: memRes.entries,
      memorySearchMeta: memRes.meta,
      vectorStatus: vecRes.vectorStatus,
    });
  },

  recalculateMemoryDecay: async () => {
    const token = get().token!;
    const res = await officeApi.recalculateMemoryDecay(token);
    const memRes = await officeApi.searchMemory(token, "");
    set({ memoryResults: memRes.entries, memorySearchMeta: memRes.meta });
    return res;
  },

  syncVectors: async () => {
    const token = get().token!;
    const res = await officeApi.syncVectors(token);
    set({ vectorStatus: res.vectorStatus });
    return res.result;
  },

  submitLearningFeedback: async (input) => {
    const token = get().token!;
    const res = await officeApi.submitLearningFeedback(token, input);
    const [learningRes, approvalsRes] = await Promise.all([
      officeApi.getLearningProposals(token),
      officeApi.getApprovals(token),
    ]);
    set({
      learningProposals: learningRes.proposals,
      approvals: approvalsRes.approvals,
    });
    return res;
  },

  rollbackLearningProposal: async (id, input) => {
    const token = get().token!;
    const res = await officeApi.rollbackLearningProposal(token, id, input);
    const [learningRes, memRes, empRes] = await Promise.all([
      officeApi.getLearningProposals(token),
      officeApi.searchMemory(token, ""),
      officeApi.getEmployees(token),
    ]);
    set({
      learningProposals: learningRes.proposals,
      memoryResults: memRes.entries,
      memorySearchMeta: memRes.meta,
      employees: empRes.employees,
    });
    return res.proposal;
  },

  summarizeConversation: async (conversationId) => {
    const token = get().token!;
    const { conversation } = await officeApi.summarizeConversation(token, conversationId);
    set((state) => ({
      conversationsByEmployee: {
        ...state.conversationsByEmployee,
        [conversation.employeeId]: (state.conversationsByEmployee[conversation.employeeId] ?? []).map(
          (c) => (c.id === conversation.id ? conversation : c),
        ),
      },
    }));
  },

  refreshProviders: async () => {
    const token = get().token;
    if (!token) return;
    const { providers } = await officeApi.refreshProviders(token);
    set({ providers });
  },

  loadAuditAndUsage: async () => {
    const token = get().token;
    if (!token) return;
    const [auditRes, usageRes] = await Promise.all([
      officeApi.getAuditLogs(token, 120),
      officeApi.getUsage(token),
    ]);
    set({ auditLogs: auditRes.logs, usage: usageRes.usage });
  },

  loadVaultAndPolicies: async () => {
    const token = get().token;
    if (!token) return;
    const [vaultRes, polRes] = await Promise.all([
      officeApi.getVaultKeys(token),
      officeApi.getCompanyPolicies(token),
    ]);
    set({ vaultKeys: vaultRes.keys, companyPolicies: polRes });
  },

  saveVaultKey: async (key, value, providerHint) => {
    const token = get().token!;
    await officeApi.saveVaultKey(token, key, value, providerHint);
    const [vaultRes, provRes, tgRes] = await Promise.all([
      officeApi.getVaultKeys(token),
      officeApi.getProviders(token),
      officeApi.getTelegramStatus(token),
    ]);
    set({
      vaultKeys: vaultRes.keys,
      providers: provRes.providers,
      telegramStatus: tgRes.status,
    });
  },

  deleteVaultKey: async (key) => {
    const token = get().token!;
    await officeApi.deleteVaultKey(token, key);
    const [vaultRes, provRes, tgRes] = await Promise.all([
      officeApi.getVaultKeys(token),
      officeApi.getProviders(token),
      officeApi.getTelegramStatus(token),
    ]);
    set({
      vaultKeys: vaultRes.keys,
      providers: provRes.providers,
      telegramStatus: tgRes.status,
    });
  },

  loadMcps: async () => {
    const token = get().token;
    if (!token) return;
    const [srvRes, tplRes, polRes] = await Promise.all([
      officeApi.getMcpServers(token),
      officeApi.getMcpTemplates(token),
      officeApi.getCompanyPolicies(token),
    ]);
    set({
      mcpServers: srvRes.servers,
      mcpTemplates: tplRes.templates,
      companyPolicies: polRes,
    });
  },

  upsertMcp: async (config) => {
    const token = get().token!;
    const { server } = await officeApi.upsertMcpServer(token, config);
    const { servers } = await officeApi.getMcpServers(token);
    set({ mcpServers: servers });
    return server;
  },

  patchMcp: async (id, patch) => {
    const token = get().token!;
    await officeApi.patchMcpServer(token, id, patch);
    const { servers } = await officeApi.getMcpServers(token);
    set({ mcpServers: servers });
  },

  deleteMcp: async (id) => {
    const token = get().token!;
    await officeApi.deleteMcpServer(token, id);
    const { servers } = await officeApi.getMcpServers(token);
    set({ mcpServers: servers });
  },

  testMcp: async (id) => {
    const token = get().token!;
    const { result } = await officeApi.testMcpServer(token, id);
    return result;
  },

  updatePolicies: async (patch) => {
    const token = get().token!;
    const updated = await officeApi.patchCompanyPolicies(token, patch);
    const tgRes = await officeApi.getTelegramStatus(token);
    set({ companyPolicies: updated, telegramStatus: tgRes.status });
  },

  loadOrchestrationAndHiring: async () => {
    const token = get().token;
    if (!token) return;
    const [plansRes, meetingsRes, hirePropsRes, hireTplsRes] = await Promise.all([
      officeApi.getTaskPlans(token),
      officeApi.getMeetings(token),
      officeApi.getHiringProposals(token),
      officeApi.getHiringTemplates(token),
    ]);
    set({
      taskPlans: plansRes.plans,
      meetings: meetingsRes.meetings,
      hiringProposals: hirePropsRes.proposals,
      hiringTemplates: hireTplsRes.templates,
    });
  },

  createTaskPlan: async (input) => {
    const token = get().token!;
    const { plan } = await officeApi.createTaskPlan(token, input);
    const { tasks } = await officeApi.getTasks(token);
    set((state) => ({
      taskPlans: [plan, ...state.taskPlans.filter((p) => p.id !== plan.id)],
      tasks,
    }));
    return plan;
  },

  startTaskPlan: async (id) => {
    const token = get().token!;
    const { plan } = await officeApi.startTaskPlan(token, id);
    set((state) => ({
      taskPlans: [plan, ...state.taskPlans.filter((p) => p.id !== plan.id)],
    }));
  },

  cancelTaskPlan: async (id) => {
    const token = get().token!;
    const { plan } = await officeApi.cancelTaskPlan(token, id);
    const { tasks } = await officeApi.getTasks(token);
    set((state) => ({
      taskPlans: state.taskPlans.map((p) => (p.id === id ? plan : p)),
      tasks,
    }));
  },

  createMeeting: async (input) => {
    const token = get().token!;
    const { meeting } = await officeApi.createMeeting(token, input);
    set((state) => ({
      meetings: [meeting, ...state.meetings.filter((m) => m.id !== meeting.id)],
    }));
    return meeting;
  },

  cancelMeeting: async (id) => {
    const token = get().token!;
    const { meeting } = await officeApi.cancelMeeting(token, id);
    set((state) => ({
      meetings: state.meetings.map((m) => (m.id === id ? meeting : m)),
    }));
  },

  createHiringProposal: async (input) => {
    const token = get().token!;
    const res = await officeApi.createHiringProposal(token, input);
    const [hirePropsRes, apprRes] = await Promise.all([
      officeApi.getHiringProposals(token),
      officeApi.getApprovals(token),
    ]);
    set({
      hiringProposals: hirePropsRes.proposals,
      approvals: apprRes.approvals,
    });
    return res;
  },

  rollbackHiringProposal: async (id, reason) => {
    const token = get().token!;
    await officeApi.rollbackHiringProposal(token, id, reason);
    const [bootRes, empRes, hirePropsRes, memRes] = await Promise.all([
      officeApi.getBootstrap(token),
      officeApi.getEmployees(token),
      officeApi.getHiringProposals(token),
      officeApi.searchMemory(token, ""),
    ]);
    set({
      company: bootRes.company,
      employees: empRes.employees,
      hiringProposals: hirePropsRes.proposals,
      memoryResults: memRes.entries,
      memorySearchMeta: memRes.meta,
    });
  },

  loadAutomation: async () => {
    const token = get().token;
    if (!token) return;
    const [schedRes, tgRes, polRes, vaultRes] = await Promise.all([
      officeApi.getSchedules(token),
      officeApi.getTelegramStatus(token),
      officeApi.getCompanyPolicies(token),
      officeApi.getVaultKeys(token),
    ]);
    set({
      scheduledJobs: schedRes.jobs,
      cronPresets: schedRes.presets,
      scheduledJobRuns: schedRes.recentRuns,
      telegramStatus: tgRes.status,
      telegramMessages: tgRes.messages,
      companyPolicies: polRes,
      vaultKeys: vaultRes.keys,
    });
  },

  createScheduledJob: async (input) => {
    const token = get().token!;
    const { job } = await officeApi.createSchedule(token, input);
    const schedRes = await officeApi.getSchedules(token);
    set({
      scheduledJobs: schedRes.jobs,
      cronPresets: schedRes.presets,
      scheduledJobRuns: schedRes.recentRuns,
    });
    return job;
  },

  updateScheduledJob: async (id, patch) => {
    const token = get().token!;
    await officeApi.updateSchedule(token, id, patch);
    const schedRes = await officeApi.getSchedules(token);
    set({
      scheduledJobs: schedRes.jobs,
      scheduledJobRuns: schedRes.recentRuns,
    });
  },

  deleteScheduledJob: async (id) => {
    const token = get().token!;
    await officeApi.deleteSchedule(token, id);
    const schedRes = await officeApi.getSchedules(token);
    set({
      scheduledJobs: schedRes.jobs,
      scheduledJobRuns: schedRes.recentRuns,
    });
  },

  runScheduledJobNow: async (id) => {
    const token = get().token!;
    const res = await officeApi.runScheduleNow(token, id);
    const schedRes = await officeApi.getSchedules(token);
    set({
      scheduledJobs: schedRes.jobs,
      scheduledJobRuns: schedRes.recentRuns,
    });
    return { triggered: res.triggered, reason: res.reason };
  },

  testTelegramBot: async () => {
    const token = get().token!;
    const res = await officeApi.testTelegramBot(token);
    set({ telegramStatus: res.status });
    return res.result;
  },

  simulateTelegramUpdate: async (input) => {
    const token = get().token!;
    const res = await officeApi.simulateTelegramUpdate(token, input);
    set({
      telegramStatus: res.status,
      telegramMessages: res.messages,
    });
    return { accepted: res.accepted, reply: res.reply, error: res.error };
  },

  saveFloorplanLayout: async (input) => {
    const token = get().token!;
    const res = await officeApi.updateFloorplanLayout(token, input);
    set({ company: res.company });
    return res.company;
  },

  loadAnalytics: async (days = 14) => {
    const token = get().token;
    if (!token) return;
    const res = await officeApi.getAnalytics(token, days);
    set({ analytics: res.analytics });
  },

  loadFilteredAudit: async (opts) => {
    const token = get().token;
    if (!token) return;
    const res = await officeApi.getFilteredAuditLogs(token, opts);
    set({ auditLogs: res.logs });
  },

  loadBackupStatus: async () => {
    const token = get().token;
    if (!token) return;
    const res = await officeApi.getBackupStatus(token);
    set({ backupStatus: res.status });
  },

  initBackupRepo: async () => {
    const token = get().token!;
    const res = await officeApi.initBackupRepo(token);
    set({ backupStatus: res.status });
  },

  createBackupSnapshot: async (message) => {
    const token = get().token!;
    const res = await officeApi.createBackupSnapshot(token, message);
    set({ backupStatus: res.status, backupDiff: "" });
    return { created: res.created };
  },

  loadBackupDiff: async (commitHash) => {
    const token = get().token;
    if (!token) return;
    const res = await officeApi.getBackupDiff(token, commitHash);
    set({ backupDiff: res.diff });
  },

  restoreBackupSnapshot: async (commitHash) => {
    const token = get().token!;
    const res = await officeApi.restoreBackupSnapshot(token, commitHash);
    const [boot, emps] = await Promise.all([
      officeApi.getBootstrap(token),
      officeApi.getEmployees(token),
    ]);
    set({
      backupStatus: res.status,
      backupDiff: "",
      company: boot.company,
      employees: emps.employees,
      projects: boot.projects,
    });
  },

  handleWsMessage: (msg) => {
    const token = get().token;

    if (msg.kind === "replay") {
      set((state) => {
        const nextEventsByRun = { ...state.eventsByRunId };
        let maxSeq = state.lastGlobalSeq;
        for (const ev of msg.events) {
          nextEventsByRun[ev.runId] = appendRunEventDedup(nextEventsByRun[ev.runId], ev);
          if (ev.seq > maxSeq) maxSeq = ev.seq;
        }
        return { eventsByRunId: nextEventsByRun, lastGlobalSeq: maxSeq };
      });
      return;
    }

    if (msg.kind === "live_delta") {
      const ev = msg.data;
      if (ev.event.type === "text_delta") {
        const deltaText = ev.event.text;
        set((state) => ({
          liveDeltaByRunId: {
            ...state.liveDeltaByRunId,
            [ev.runId]: (state.liveDeltaByRunId[ev.runId] ?? "") + deltaText,
          },
        }));
      }
      return;
    }

    if (msg.kind === "run_event") {
      const ev = msg.data;
      set((state) => {
        const nextMax = ev.seq > state.lastGlobalSeq ? ev.seq : state.lastGlobalSeq;
        return {
          lastGlobalSeq: nextMax,
          eventsByRunId: {
            ...state.eventsByRunId,
            [ev.runId]: appendRunEventDedup(state.eventsByRunId[ev.runId], ev),
          },
        };
      });

      if (ev.event.type === "approval_requested" && token) {
        void officeApi.getApprovals(token).then((res) => {
          set({ approvals: res.approvals });
        });
      }
      return;
    }

    if (msg.kind === "run_status") {
      const run = msg.data;
      const prevRun = get().runs.find((r) => r.id === run.id);
      const isTerminal = [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "BUDGET_EXCEEDED",
        "WAITING_APPROVAL",
      ].includes(run.status);

      set((state) => {
        const nextLive = { ...state.liveDeltaByRunId };
        if (isTerminal) {
          delete nextLive[run.id];
        }
        return {
          runs: [run, ...state.runs.filter((r) => r.id !== run.id)],
          liveDeltaByRunId: nextLive,
        };
      });

      if (prevRun?.status !== run.status) {
        const emp = get().employees.find((e) => e.profile.id === run.employeeId);
        const empAr = emp?.profile.nameAr ?? run.employeeId;
        const empEn = emp?.profile.name ?? run.employeeId;
        if (run.status === "WAITING_APPROVAL") {
          get().pushNotification({
            level: "warning",
            title: `${empEn}: Approval Required`,
            titleAr: `${empAr}: بانتظار موافقتك`,
            detail: run.prompt.slice(0, 120),
            targetView: "approvals",
          });
        } else if (run.status === "FAILED" || run.status === "BUDGET_EXCEEDED" || run.status === "TIMED_OUT") {
          get().pushNotification({
            level: "error",
            title: `${empEn}: ${run.status}`,
            titleAr: `${empAr}: توقف (${run.status})`,
            detail: run.errorMessage ?? run.prompt.slice(0, 100),
            targetView: "office",
            employeeId: run.employeeId,
          });
        } else if (run.status === "COMPLETED") {
          get().pushNotification({
            level: "success",
            title: `${empEn}: Task Completed`,
            titleAr: `${empAr}: أتمّ المهمة`,
            detail: run.finalOutput?.slice(0, 100) ?? run.prompt.slice(0, 100),
            targetView: "office",
            employeeId: run.employeeId,
          });
        }
      }

      if (isTerminal && token) {
        void Promise.all([
          officeApi.getConversationMessages(token, run.conversationId),
          officeApi.getApprovals(token),
          officeApi.getUsage(token),
        ]).then(([msgData, apprData, usageData]) => {
          set((state) => ({
            conversationsByEmployee: {
              ...state.conversationsByEmployee,
              [run.employeeId]: (state.conversationsByEmployee[run.employeeId] ?? []).map((c) =>
                c.id === run.conversationId ? msgData.conversation : c,
              ),
            },
            messagesByConversationId: {
              ...state.messagesByConversationId,
              [run.conversationId]: msgData.messages,
            },
            approvals: apprData.approvals,
            usage: usageData.usage,
          }));
        });
      }
      return;
    }

    if (msg.kind === "plan_updated") {
      const plan = msg.data;
      set((state) => ({
        taskPlans: [plan, ...state.taskPlans.filter((p) => p.id !== plan.id)],
      }));
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(plan.status) && token) {
        void officeApi.getTasks(token).then((r) => set({ tasks: r.tasks }));
      }
      return;
    }

    if (msg.kind === "meeting_updated") {
      const meeting = msg.data;
      set((state) => ({
        meetings: [meeting, ...state.meetings.filter((m) => m.id !== meeting.id)],
      }));
      if (meeting.status === "COMPLETED" && token) {
        void officeApi.getTasks(token).then((r) => set({ tasks: r.tasks }));
      }
      return;
    }

    if (msg.kind === "hiring_updated") {
      const prop = msg.data;
      set((state) => ({
        hiringProposals: [prop, ...state.hiringProposals.filter((h) => h.id !== prop.id)],
      }));
      return;
    }

    if (msg.kind === "schedule_updated") {
      const job = msg.data;
      set((state) => ({
        scheduledJobs: [job, ...state.scheduledJobs.filter((j) => j.id !== job.id)],
      }));
      return;
    }

    if (msg.kind === "telegram_message") {
      const m = msg.data;
      set((state) => ({
        telegramMessages: [m, ...state.telegramMessages.filter((x) => x.id !== m.id)].slice(0, 60),
      }));
      return;
    }

    if (msg.kind === "company_updated") {
      set({ company: msg.data });
    }
  },
}));

/**
 * Computes an employee's real-time operational state for the 2D floorplan & drawers.
 */
export function selectEmployeeLiveState(
  state: Pick<OfficeState, "runs" | "approvals">,
  employeeId: string,
): { status: EmployeeLiveStatus; activeRun: Run | null; pendingApprovalCount: number } {
  const empApprovals = state.approvals.filter(
    (a) => a.employeeId === employeeId && a.status === "PENDING",
  );
  const empRuns = state.runs.filter((r) => r.employeeId === employeeId);
  const activeRun =
    empRuns.find((r) => r.status === "RUNNING" || r.status === "PLANNING") ??
    empRuns.find((r) => r.status === "QUEUED") ??
    empRuns.find((r) => r.status === "WAITING_APPROVAL") ??
    null;

  if (empApprovals.length > 0 || activeRun?.status === "WAITING_APPROVAL") {
    return { status: "waiting_approval", activeRun, pendingApprovalCount: empApprovals.length };
  }
  if (activeRun?.status === "RUNNING" || activeRun?.status === "PLANNING") {
    return { status: "working", activeRun, pendingApprovalCount: 0 };
  }
  if (activeRun?.status === "QUEUED") {
    return { status: "queued", activeRun, pendingApprovalCount: 0 };
  }
  const latest = empRuns[0];
  if (latest && (latest.status === "FAILED" || latest.status === "BUDGET_EXCEEDED" || latest.status === "TIMED_OUT")) {
    return { status: "failed", activeRun: latest, pendingApprovalCount: 0 };
  }
  return { status: "idle", activeRun: latest ?? null, pendingApprovalCount: 0 };
}
