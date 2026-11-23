import { z } from "zod";
import { TelegramPolicySchema } from "./automation.js";
import { LanguagePolicySchema } from "./employee.js";
import { BrowserSecurityPolicySchema } from "./mcp.js";
import { MemoryPolicySchema } from "./memory.js";
import { DeskRotationSchema, FloorplanThemeSchema } from "./phase6.js";
import { BudgetPolicySchema } from "./runtime.js";

export const DepartmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  color: z.string().min(1),
});
export type Department = z.infer<typeof DepartmentSchema>;

export const FloorplanZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  kind: z.enum(["workstations", "meeting_room", "manager_office", "lounge"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type FloorplanZone = z.infer<typeof FloorplanZoneSchema>;

export const FloorplanDeskSchema = z.object({
  id: z.string().min(1),
  zoneId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  employeeId: z.string().optional(),
  rotationDeg: DeskRotationSchema.optional(),
});
export type FloorplanDesk = z.infer<typeof FloorplanDeskSchema>;

export const OfficeFloorplanSchema = z.object({
  width: z.number().default(1200),
  height: z.number().default(760),
  theme: FloorplanThemeSchema.optional(),
  zones: z.array(FloorplanZoneSchema),
  desks: z.array(FloorplanDeskSchema),
});
export type OfficeFloorplan = z.infer<typeof OfficeFloorplanSchema>;

export const CompanyConfigSchema = z.object({
  name: z.string().min(1),
  nameAr: z.string().min(1),
  languagePolicy: LanguagePolicySchema.default("match-user-keep-tech-english"),
  departments: z.array(DepartmentSchema),
  budgets: BudgetPolicySchema,
  security: BrowserSecurityPolicySchema.optional(),
  memory: MemoryPolicySchema.optional(),
  telegram: TelegramPolicySchema.optional(),
  floorplan: OfficeFloorplanSchema,
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;
