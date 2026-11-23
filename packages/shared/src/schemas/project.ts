import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  isGitRepo: z.boolean(),
  defaultBranch: z.string().optional(),
  description: z.string().default(""),
  assignedEmployeeIds: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  dailyBudgetUsd: z.number().positive().default(15.0),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const RegisterProjectInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  description: z.string().default(""),
  assignedEmployeeIds: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  dailyBudgetUsd: z.number().positive().default(15.0),
});
export type RegisterProjectInput = z.input<typeof RegisterProjectInputSchema>;
