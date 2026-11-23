import { z } from "zod";
import { RunModeSchema } from "./task.js";

export const ScheduledJobSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  cronExpression: z.string().min(5),
  employeeId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  prompt: z.string().min(1),
  mode: RunModeSchema.default("live"),
  riskTier: z.enum(["tier1_auto", "tier2_guarded"]).default("tier1_auto"),
  enabled: z.boolean().default(true),
  maxRunsPerDay: z.number().int().min(1).max(48).default(6),
  runsTodayCount: z.number().int().nonnegative().default(0),
  lastRunDay: z.string().nullable().optional(),
  lastRunId: z.string().nullable().optional(),
  lastRunStatus: z.string().nullable().optional(),
  lastRunAt: z.string().nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export const CreateScheduledJobInputSchema = z.object({
  name: z.string().min(1).max(120),
  cronExpression: z.string().min(5),
  employeeId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  prompt: z.string().min(3),
  mode: RunModeSchema.default("live"),
  riskTier: z.enum(["tier1_auto", "tier2_guarded"]).default("tier1_auto"),
  enabled: z.boolean().default(true),
  maxRunsPerDay: z.number().int().min(1).max(48).default(6),
});
export type CreateScheduledJobInput = z.input<typeof CreateScheduledJobInputSchema>;

export const UpdateScheduledJobInputSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cronExpression: z.string().min(5).optional(),
  employeeId: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  prompt: z.string().min(3).optional(),
  mode: RunModeSchema.optional(),
  riskTier: z.enum(["tier1_auto", "tier2_guarded"]).optional(),
  enabled: z.boolean().optional(),
  maxRunsPerDay: z.number().int().min(1).max(48).optional(),
});
export type UpdateScheduledJobInput = z.input<typeof UpdateScheduledJobInputSchema>;

export const ScheduledJobRunRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  runId: z.string().nullable().optional(),
  triggerSource: z.enum(["cron", "manual"]),
  status: z.string(),
  summary: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ScheduledJobRunRecord = z.infer<typeof ScheduledJobRunRecordSchema>;

export interface CronPreset {
  id: string;
  label: string;
  labelAr: string;
  expression: string;
}

export const TelegramPolicySchema = z.object({
  enabled: z.boolean().default(false),
  allowedChatIds: z.array(z.string().min(1)).default([]),
  defaultEmployeeId: z.string().min(1).default("general-manager"),
  notifyApprovals: z.boolean().default(true),
  notifyRunCompletion: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(1500).max(60_000).default(4000),
});
export type TelegramPolicy = z.infer<typeof TelegramPolicySchema>;

export const TelegramMessageRecordSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  text: z.string(),
  linkedRunId: z.string().nullable().optional(),
  linkedApprovalId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type TelegramMessageRecord = z.infer<typeof TelegramMessageRecordSchema>;

export const TelegramStatusSchema = z.object({
  enabled: z.boolean(),
  hasToken: z.boolean(),
  pollingActive: z.boolean(),
  allowedChatCount: z.number().int().nonnegative(),
  defaultEmployeeId: z.string(),
  botUsername: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
});
export type TelegramStatus = z.infer<typeof TelegramStatusSchema>;
