import { z } from "zod";
import { RuntimeProviderSchema } from "./employee.js";
import { RunModeSchema } from "./task.js";

export const TaskPlanStatusSchema = z.enum([
  "DRAFT",
  "RUNNING",
  "PAUSED_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type TaskPlanStatus = z.infer<typeof TaskPlanStatusSchema>;

export const PlanNodeStatusSchema = z.enum([
  "PENDING",
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);
export type PlanNodeStatus = z.infer<typeof PlanNodeStatusSchema>;

export const PlanNodeInputSchema = z.object({
  nodeKey: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  assignedEmployeeId: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([]),
  riskTier: z.enum(["tier1_auto", "tier2_guarded"]).default("tier1_auto"),
  providerOverride: RuntimeProviderSchema.optional(),
  modelOverride: z.string().optional(),
});
export type PlanNodeInput = z.input<typeof PlanNodeInputSchema>;

export const PlanNodeSchema = z.object({
  id: z.string(),
  planId: z.string(),
  nodeKey: z.string(),
  taskId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().default(""),
  assignedEmployeeId: z.string(),
  dependsOn: z.array(z.string()).default([]),
  riskTier: z.enum(["tier1_auto", "tier2_guarded"]).default("tier1_auto"),
  providerOverride: RuntimeProviderSchema.nullable().optional(),
  modelOverride: z.string().nullable().optional(),
  status: PlanNodeStatusSchema,
  outputSummary: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
export type PlanNode = z.infer<typeof PlanNodeSchema>;

export const TaskPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  orchestratorEmployeeId: z.string(),
  projectId: z.string().nullable().optional(),
  rootTaskId: z.string().nullable().optional(),
  mode: RunModeSchema.default("live"),
  maxConcurrency: z.number().int().min(1).max(3).default(2),
  status: TaskPlanStatusSchema,
  synthesisSummary: z.string().nullable().optional(),
  nodes: z.array(PlanNodeSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const CreateTaskPlanInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().min(3),
  orchestratorEmployeeId: z.string().min(1).default("general-manager"),
  projectId: z.string().nullable().optional(),
  mode: RunModeSchema.default("live"),
  maxConcurrency: z.number().int().min(1).max(3).default(2),
  steps: z.array(PlanNodeInputSchema).min(1).max(15).optional(),
  autoStart: z.boolean().default(true),
  mockScenario: z.string().optional(),
});
export type CreateTaskPlanInput = z.input<typeof CreateTaskPlanInputSchema>;
