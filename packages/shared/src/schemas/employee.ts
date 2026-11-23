import { z } from "zod";
import { RiskTierSchema } from "./approval.js";

export const LanguagePolicySchema = z.enum([
  "match-user-keep-tech-english",
  "arabic",
  "english",
]);
export type LanguagePolicy = z.infer<typeof LanguagePolicySchema>;

export const RuntimeProviderSchema = z.enum([
  "agy",
  "codex",
  "claude",
  "gemini_api",
  "openai_api",
  "anthropic_api",
  "openrouter_api",
  "ollama",
  "mock",
]);
export type RuntimeProvider = z.infer<typeof RuntimeProviderSchema>;

export const EffortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const RuntimeConfigSchema = z.object({
  provider: RuntimeProviderSchema,
  model: z.string().min(1),
  effort: EffortLevelSchema.optional(),
  fallbackProvider: RuntimeProviderSchema.optional(),
  fallbackModel: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const EmployeePermissionsSchema = z.object({
  allowedTools: z.array(z.string()).default(["read_file", "search", "analyze"]),
  deniedTools: z.array(z.string()).default([]),
  maxRiskTier: RiskTierSchema.default("tier1_auto"),
  tier2AutoInWorktree: z.boolean().default(false),
  allowExternalWrite: z.boolean().default(false),
  allowedProjectIds: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  maxStepsPerRun: z.number().int().positive().default(25),
  taskBudgetUsd: z.number().positive().default(1.5),
  dailyBudgetUsd: z.number().positive().default(10.0),
  grantedEnvKeys: z.array(z.string()).default([]),
});
export type EmployeePermissions = z.infer<typeof EmployeePermissionsSchema>;

export const EmployeeProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  role: z.string().min(1),
  roleAr: z.string().min(1),
  department: z.string().min(1),
  avatar: z.string().min(1),
  avatarModelUrl: z
    .string()
    .regex(/^\/(assets|company-assets)\/avatars\/[a-zA-Z0-9._-]+\.glb$/)
    .refine((v) => !v.includes(".."), "Path traversal is not allowed")
    .optional(),
  avatarTone: z.string().min(1).max(32).optional(),
  deskId: z.string().min(1),
  runtime: RuntimeConfigSchema,
  languagePolicy: LanguagePolicySchema.optional(),
  isOrchestrator: z.boolean().optional().default(false),
});
export type EmployeeProfile = z.infer<typeof EmployeeProfileSchema>;

export const LoadedEmployeeSchema = z.object({
  profile: EmployeeProfileSchema,
  permissions: EmployeePermissionsSchema,
  systemPrompt: z.string(),
  skills: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
      filePath: z.string(),
    }),
  ),
  rootDir: z.string(),
});
export type LoadedEmployee = z.infer<typeof LoadedEmployeeSchema>;
