import { z } from "zod";
import {
  EmployeePermissionsSchema,
  LanguagePolicySchema,
  RuntimeConfigSchema,
} from "./employee.js";
import { FloorplanDeskSchema } from "./office.js";

export const HiringProposalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "PROVISIONED",
  "REJECTED",
  "ROLLED_BACK",
]);
export type HiringProposalStatus = z.infer<typeof HiringProposalStatusSchema>;

export const CreateHiringProposalInputSchema = z.object({
  proposedByEmployeeId: z.string().min(1).default("hr-talent"),
  employeeId: z.string().min(1).optional(),
  name: z.string().min(2).max(80),
  nameAr: z.string().min(2).max(80),
  role: z.string().min(2).max(120),
  roleAr: z.string().min(2).max(120),
  department: z.string().min(1).default("engineering"),
  avatar: z.string().min(1).max(4),
  justification: z.string().min(3),
  systemPrompt: z.string().min(10),
  coreSkillTitle: z.string().min(2).max(120).default("Core Operating SOP"),
  coreSkillContent: z.string().min(10),
  runtime: RuntimeConfigSchema.default({
    provider: "agy",
    model: "gemini-3.8-flash-medium",
    effort: "medium",
  }),
  permissions: EmployeePermissionsSchema.partial().optional(),
  languagePolicy: LanguagePolicySchema.optional(),
  autoSubmitForApproval: z.boolean().default(true),
});
export type CreateHiringProposalInput = z.input<typeof CreateHiringProposalInputSchema>;

export const HiringProposalSpecSchema = z.object({
  proposedByEmployeeId: z.string(),
  employeeId: z.string(),
  name: z.string(),
  nameAr: z.string(),
  role: z.string(),
  roleAr: z.string(),
  department: z.string(),
  avatar: z.string(),
  justification: z.string(),
  systemPrompt: z.string(),
  coreSkillTitle: z.string(),
  coreSkillContent: z.string(),
  runtime: RuntimeConfigSchema,
  permissions: EmployeePermissionsSchema,
  languagePolicy: LanguagePolicySchema,
});
export type HiringProposalSpec = z.infer<typeof HiringProposalSpecSchema>;

export const HiringProposalSchema = z.object({
  id: z.string(),
  proposedByEmployeeId: z.string(),
  employeeId: z.string(),
  spec: HiringProposalSpecSchema,
  proposedDesk: FloorplanDeskSchema,
  diffPreview: z.string(),
  status: HiringProposalStatusSchema,
  approvalId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  provisionedAt: z.string().nullable().optional(),
  rolledBackAt: z.string().nullable().optional(),
  rollbackReason: z.string().nullable().optional(),
});
export type HiringProposal = z.infer<typeof HiringProposalSchema>;

export const HiringRoleTemplateSchema = z.object({
  id: z.string(),
  label: z.string(),
  labelAr: z.string(),
  description: z.string(),
  descriptionAr: z.string(),
  defaults: CreateHiringProposalInputSchema,
});
export type HiringRoleTemplate = z.infer<typeof HiringRoleTemplateSchema>;
