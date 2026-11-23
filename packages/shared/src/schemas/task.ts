import { z } from "zod";
import { RiskTierSchema } from "./approval.js";
import { RuntimeProviderSchema } from "./employee.js";

export const TaskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "waiting_approval",
  "review",
  "done",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable().optional(),
  assignedEmployeeId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: TaskStatusSchema.default("todo"),
  priority: TaskPrioritySchema.default("medium"),
  deliverables: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInputSchema = z.object({
  projectId: z.string().nullable().optional(),
  assignedEmployeeId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: TaskStatusSchema.default("todo"),
  priority: TaskPrioritySchema.default("medium"),
});
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

export const RunModeSchema = z.enum(["live", "dry_run", "mock"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunStatusSchema = z.enum([
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "INTERRUPTED",
  "BUDGET_EXCEEDED",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "TIMEOUT",
  "BUDGET_EXCEEDED",
  "SANDBOX_DENIED",
  "LOOP_DETECTED",
  "CLI_CRASH",
  "NETWORK_ERROR",
  "CANCELLED",
  "INTERNAL_ERROR",
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

export const RunSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  employeeId: z.string(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  mode: RunModeSchema,
  status: RunStatusSchema,
  runtimeProvider: RuntimeProviderSchema,
  model: z.string(),
  riskTier: RiskTierSchema,
  prompt: z.string(),
  configSnapshot: z.record(z.unknown()),
  finalOutput: z.string().nullable().optional(),
  errorCode: RunErrorCodeSchema.nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  worktreeBranch: z.string().nullable().optional(),
  worktreePath: z.string().nullable().optional(),
  diffStat: z.string().nullable().optional(),
  costUsd: z.number().default(0),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const CreateRunInputSchema = z.object({
  employeeId: z.string().min(1),
  conversationId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  prompt: z.string().min(1),
  mode: RunModeSchema.default("live"),
  riskTier: RiskTierSchema.optional(),
  providerOverride: RuntimeProviderSchema.optional(),
  modelOverride: z.string().optional(),
  mockScenario: z.string().optional(),
  externalInputs: z
    .array(
      z.object({
        source: z.string().min(1),
        content: z.string(),
      }),
    )
    .optional(),
});
export type CreateRunInput = z.input<typeof CreateRunInputSchema>;
