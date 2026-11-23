import { z } from "zod";
import { RunModeSchema, TaskPrioritySchema } from "./task.js";

export const MeetingStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const MeetingTurnSchema = z.object({
  id: z.string(),
  meetingId: z.string(),
  round: z.number().int().min(1).max(3),
  turnIndex: z.number().int().nonnegative(),
  employeeId: z.string(),
  runId: z.string().nullable().optional(),
  summary: z.string(),
  keyPoints: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type MeetingTurn = z.infer<typeof MeetingTurnSchema>;

export const MeetingActionItemSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  assignedEmployeeId: z.string(),
  priority: TaskPrioritySchema.default("medium"),
  taskId: z.string().nullable().optional(),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

export const MeetingRecordSchema = z.object({
  id: z.string(),
  topic: z.string(),
  agenda: z.string().default(""),
  projectId: z.string().nullable().optional(),
  facilitatorEmployeeId: z.string(),
  participantEmployeeIds: z.array(z.string()),
  maxRounds: z.number().int().min(1).max(3).default(2),
  mode: RunModeSchema.default("live"),
  autoCreateTasks: z.boolean().default(true),
  status: MeetingStatusSchema,
  turns: z.array(MeetingTurnSchema).default([]),
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(MeetingActionItemSchema).default([]),
  minutesSummary: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});
export type MeetingRecord = z.infer<typeof MeetingRecordSchema>;

export const CreateMeetingInputSchema = z.object({
  topic: z.string().min(3).max(200),
  agenda: z.string().default(""),
  projectId: z.string().nullable().optional(),
  facilitatorEmployeeId: z.string().min(1).default("general-manager"),
  participantEmployeeIds: z.array(z.string().min(1)).min(2).max(5),
  maxRounds: z.number().int().min(1).max(3).default(2),
  mode: RunModeSchema.default("live"),
  autoCreateTasks: z.boolean().default(true),
  mockScenario: z.string().optional(),
});
export type CreateMeetingInput = z.input<typeof CreateMeetingInputSchema>;
