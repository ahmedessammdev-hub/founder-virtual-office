import { z } from "zod";
import { MemoryScopeSchema } from "./memory.js";

export const FeedbackRatingSchema = z.enum(["positive", "correction", "issue"]);
export type FeedbackRating = z.infer<typeof FeedbackRatingSchema>;

export const LearningTargetKindSchema = z.enum([
  "memory_note",
  "employee_skill",
  "employee_system",
]);
export type LearningTargetKind = z.infer<typeof LearningTargetKindSchema>;

export const LearningProposalStatusSchema = z.enum([
  "DRAFT",
  "EVALUATED",
  "PENDING_APPROVAL",
  "APPLIED",
  "REJECTED",
  "ROLLED_BACK",
]);
export type LearningProposalStatus = z.infer<typeof LearningProposalStatusSchema>;

export const SubmitFeedbackInputSchema = z.object({
  employeeId: z.string().min(1),
  runId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  rating: FeedbackRatingSchema.default("correction"),
  feedbackText: z.string().min(3),
  expectedBehavior: z.string().optional(),
  targetKind: LearningTargetKindSchema.default("memory_note"),
  targetSkillName: z.string().optional(),
  scope: MemoryScopeSchema.default("employee"),
  autoSubmitForApproval: z.boolean().default(true),
});
export type SubmitFeedbackInput = z.input<typeof SubmitFeedbackInputSchema>;

export const LearningEvaluationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type LearningEvaluationCheck = z.infer<typeof LearningEvaluationCheckSchema>;

export const LearningEvaluationSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  checks: z.array(LearningEvaluationCheckSchema),
  summary: z.string(),
});
export type LearningEvaluation = z.infer<typeof LearningEvaluationSchema>;

export const LearningProposalSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  projectId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  feedbackRating: FeedbackRatingSchema,
  feedbackText: z.string(),
  expectedBehavior: z.string().nullable().optional(),
  reflection: z.string(),
  targetKind: LearningTargetKindSchema,
  targetFilePath: z.string(),
  scope: MemoryScopeSchema,
  proposedTitle: z.string(),
  beforeContent: z.string(),
  afterContent: z.string(),
  diffPreview: z.string(),
  evaluation: LearningEvaluationSchema,
  status: LearningProposalStatusSchema,
  approvalId: z.string().nullable().optional(),
  snapshotBeforeSha256: z.string().nullable().optional(),
  snapshotAfterSha256: z.string().nullable().optional(),
  rolledBackAt: z.string().nullable().optional(),
  rollbackReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  appliedAt: z.string().nullable().optional(),
});
export type LearningProposal = z.infer<typeof LearningProposalSchema>;

export const RollbackProposalInputSchema = z.object({
  reason: z.string().optional(),
  force: z.boolean().default(false),
});
export type RollbackProposalInput = z.input<typeof RollbackProposalInputSchema>;
