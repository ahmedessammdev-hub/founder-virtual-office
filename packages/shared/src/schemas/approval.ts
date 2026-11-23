import { z } from "zod";

/**
 * 3-tier governance risk classification for employee actions.
 */
export const RiskTierSchema = z.enum(["tier1_auto", "tier2_guarded", "tier3_approval"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ApprovalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "EXECUTED",
  "FAILED",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const PreconditionSnapshotSchema = z.object({
  projectId: z.string().optional(),
  gitHeadSha: z.string().optional(),
  targetFilePath: z.string().optional(),
  targetFileSha256: z.string().optional(),
});
export type PreconditionSnapshot = z.infer<typeof PreconditionSnapshotSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  runId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  employeeId: z.string(),
  projectId: z.string().nullable().optional(),
  actionType: z.string(),
  riskTier: RiskTierSchema,
  title: z.string(),
  summary: z.string(),
  payload: z.record(z.unknown()),
  payloadHash: z.string(),
  preconditionSnapshot: PreconditionSnapshotSchema.nullable().optional(),
  diffPreview: z.string().nullable().optional(),
  idempotencyKey: z.string(),
  taintedByExternalInput: z.boolean().default(false),
  status: ApprovalStatusSchema,
  decisionNote: z.string().nullable().optional(),
  executionResult: z.record(z.unknown()).nullable().optional(),
  expiresAt: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionInputSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().optional(),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;
