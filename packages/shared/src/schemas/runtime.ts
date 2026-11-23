import { z } from "zod";
import { RiskTierSchema } from "./approval.js";
import { RuntimeProviderSchema } from "./employee.js";
import { RunErrorCodeSchema, RunModeSchema } from "./task.js";

/**
 * Unified streaming event contract emitted by every RuntimeAdapter and replayed over REST/WS.
 */
export const NormalizedAgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: z.string(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("context_assembled"),
    tokenEstimate: z.number().int(),
    injectedMemoryIds: z.array(z.string()),
    hasUntrustedExternalInput: z.boolean(),
    slices: z.record(z.number().int()),
  }),
  z.object({
    type: z.literal("text_delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("thinking"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string(),
    args: z.record(z.unknown()).default({}),
    riskTier: RiskTierSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    success: z.boolean(),
    outputPreview: z.string(),
    artifactPath: z.string().optional(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("approval_requested"),
    actionType: z.string(),
    riskTier: RiskTierSchema.default("tier3_approval"),
    title: z.string(),
    summary: z.string(),
    payload: z.record(z.unknown()),
    diffPreview: z.string().optional(),
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    mode: RunModeSchema.optional(),
  }),
  z.object({
    type: z.literal("session_id"),
    sessionId: z.string(),
    provider: RuntimeProviderSchema,
  }),
  z.object({
    type: z.literal("warning"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    errorCode: RunErrorCodeSchema,
    message: z.string(),
    recoverable: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("done"),
    finalOutput: z.string().optional(),
  }),
]);
export type NormalizedAgentEvent = z.infer<typeof NormalizedAgentEventSchema>;

export const AuthStatusSchema = z.enum(["authenticated", "unauthenticated", "unknown", "not_applicable"]);
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const ProviderHealthSchema = z.object({
  provider: RuntimeProviderSchema,
  installed: z.boolean(),
  available: z.boolean(),
  authStatus: AuthStatusSchema,
  version: z.string().optional(),
  models: z.array(z.string()).default([]),
  message: z.string().optional(),
  checkedAt: z.string(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const BudgetPolicySchema = z.object({
  defaultTaskBudgetUsd: z.number().positive().default(1.5),
  defaultDailyBudgetUsd: z.number().positive().default(15.0),
  providerDailyCapsUsd: z.record(z.number().positive()).default({}),
  maxConcurrentRuns: z.number().int().positive().default(2),
  defaultRunTimeoutMs: z.number().int().positive().default(300_000),
  allowPaidFallback: z.boolean().default(false),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;
