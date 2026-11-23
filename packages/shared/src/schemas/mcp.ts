import { z } from "zod";
import { RiskTierSchema } from "./approval.js";

export const McpTransportSchema = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  url: z.string().optional(),
  envVaultKeys: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  defaultRiskTier: RiskTierSchema.default("tier1_auto"),
  allowedEmployeeIds: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  toolRiskOverrides: z.record(RiskTierSchema).default({}),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpServerConfigInput = z.input<typeof McpServerConfigSchema>;

export const McpRegistrySchema = z.object({
  servers: z.array(McpServerConfigSchema).default([]),
});
export type McpRegistry = z.infer<typeof McpRegistrySchema>;

export const VaultKeySummarySchema = z.object({
  key: z.string().min(1),
  maskedValue: z.string(),
  providerHint: z.string().optional(),
  updatedAt: z.string(),
});
export type VaultKeySummary = z.infer<typeof VaultKeySummarySchema>;

export const BrowserSecurityPolicySchema = z.object({
  enabled: z.boolean().default(true),
  domainAllowlist: z
    .array(z.string())
    .default([
      "github.com",
      "api.github.com",
      "docs.github.com",
      "npmjs.com",
      "developer.mozilla.org",
    ]),
  maxResponseBytes: z.number().int().positive().default(262_144),
});
export type BrowserSecurityPolicy = z.infer<typeof BrowserSecurityPolicySchema>;
