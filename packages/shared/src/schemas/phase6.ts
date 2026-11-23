import { z } from "zod";

export const FloorplanThemeSchema = z.enum(["sunlit_studio", "warm_sand", "blueprint_slate"]);
export type FloorplanTheme = z.infer<typeof FloorplanThemeSchema>;

export const DeskRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type DeskRotation = z.infer<typeof DeskRotationSchema>;

const FloorplanDepartmentInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  color: z.string().min(1),
});

const FloorplanZoneInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  kind: z.enum(["workstations", "meeting_room", "manager_office", "lounge"]),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const FloorplanDeskInputSchema = z.object({
  id: z.string().min(1),
  zoneId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  employeeId: z.string().optional(),
  rotationDeg: DeskRotationSchema.optional(),
});

export const UpdateFloorplanLayoutInputSchema = z.object({
  width: z.number().int().min(900).max(4000).optional(),
  height: z.number().int().min(600).max(2400).optional(),
  theme: FloorplanThemeSchema.optional(),
  departments: z.array(FloorplanDepartmentInputSchema).optional(),
  zones: z.array(FloorplanZoneInputSchema).optional(),
  desks: z.array(FloorplanDeskInputSchema).optional(),
});
export type UpdateFloorplanLayoutInput = z.input<typeof UpdateFloorplanLayoutInputSchema>;

export const AnalyticsTotalsSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  completedRuns: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  waitingApprovalRuns: z.number().int().nonnegative(),
  cancelledRuns: z.number().int().nonnegative(),
  successRatePct: z.number().min(0).max(100),
  avgDurationMs: z.number().nonnegative(),
  liveTotalUsd: z.number().nonnegative(),
  liveTodayUsd: z.number().nonnegative(),
  mockTotalUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  executedApprovals: z.number().int().nonnegative(),
  rejectedApprovals: z.number().int().nonnegative(),
  deniedAuditEvents: z.number().int().nonnegative(),
  rateLimitedEvents: z.number().int().nonnegative(),
});

export const AnalyticsDailyPointSchema = z.object({
  day: z.string(),
  runsCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  liveCostUsd: z.number().nonnegative(),
  mockCostUsd: z.number().nonnegative(),
});

export const AnalyticsEmployeeBreakdownSchema = z.object({
  employeeId: z.string(),
  runsCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  liveCostUsd: z.number().nonnegative(),
  mockCostUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const AnalyticsProjectBreakdownSchema = z.object({
  projectId: z.string(),
  runsCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  liveCostUsd: z.number().nonnegative(),
});

export const AnalyticsProviderBreakdownSchema = z.object({
  provider: z.string(),
  mode: z.string(),
  runsCount: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const AnalyticsSecuritySignalSchema = z.object({
  action: z.string(),
  status: z.string(),
  count: z.number().int().nonnegative(),
});

export const AnalyticsBaselineDeltaSchema = z.object({
  previousRuns: z.number().int().nonnegative(),
  runsDeltaPct: z.number(),
  previousLiveUsd: z.number().nonnegative(),
  liveUsdDeltaPct: z.number(),
  previousSuccessRatePct: z.number().min(0).max(100),
  successRateDeltaPts: z.number(),
});

export const AnalyticsSummarySchema = z.object({
  generatedAt: z.string(),
  daysWindow: z.number().int().min(1).max(90),
  totals: AnalyticsTotalsSchema,
  baselineDelta: AnalyticsBaselineDeltaSchema.optional(),
  dailySeries: z.array(AnalyticsDailyPointSchema),
  byEmployee: z.array(AnalyticsEmployeeBreakdownSchema),
  byProject: z.array(AnalyticsProjectBreakdownSchema),
  byProvider: z.array(AnalyticsProviderBreakdownSchema),
  securitySignals: z.array(AnalyticsSecuritySignalSchema),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

export const GitCommitEntrySchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  dateIso: z.string(),
});
export type GitCommitEntry = z.infer<typeof GitCommitEntrySchema>;

export const GitBackupStatusSchema = z.object({
  initialized: z.boolean(),
  branch: z.string().nullable(),
  headHash: z.string().nullable(),
  dirtyCount: z.number().int().nonnegative(),
  changedFiles: z.array(z.string()),
  commits: z.array(GitCommitEntrySchema),
});
export type GitBackupStatus = z.infer<typeof GitBackupStatusSchema>;

export const CreateGitSnapshotInputSchema = z.object({
  message: z.string().min(1).max(160).optional(),
});
export type CreateGitSnapshotInput = z.input<typeof CreateGitSnapshotInputSchema>;

export const RestoreGitSnapshotInputSchema = z.object({
  commitHash: z.string().regex(/^[0-9a-fA-F]{7,40}$/),
});
export type RestoreGitSnapshotInput = z.input<typeof RestoreGitSnapshotInputSchema>;
