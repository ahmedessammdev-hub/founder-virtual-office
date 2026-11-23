import { z } from "zod";

export const MemoryScopeSchema = z.enum(["company", "project", "employee"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryTypeSchema = z.enum(["working", "episodic", "semantic", "procedural"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryVerificationSchema = z.enum(["tool_output", "human", "unverified"]);
export type MemoryVerification = z.infer<typeof MemoryVerificationSchema>;

export const MemoryStatusSchema = z.enum(["active", "conflict", "superseded", "archived"]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryRetrievalModeSchema = z.enum(["fts", "vector", "hybrid", "recent"]);
export type MemoryRetrievalMode = z.infer<typeof MemoryRetrievalModeSchema>;

export const MemoryCitationSchema = z.object({
  kind: z.enum(["conversation", "file", "command", "run", "url", "human"]),
  ref: z.string(),
  summary: z.string().optional(),
});
export type MemoryCitation = z.infer<typeof MemoryCitationSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  projectId: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  memoryType: MemoryTypeSchema,
  title: z.string(),
  content: z.string(),
  sourceCitations: z.array(MemoryCitationSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  verifiedBy: MemoryVerificationSchema.default("unverified"),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  decayScore: z.number().min(0).max(1).default(1.0),
  supersedesId: z.string().nullable().optional(),
  taintedByExternalInput: z.boolean().default(false),
  status: MemoryStatusSchema.default("active"),
  conflictWithId: z.string().nullable().optional(),
  conflictReason: z.string().nullable().optional(),
  effectiveScore: z.number().min(0).max(1).optional(),
  retrievalMode: MemoryRetrievalModeSchema.optional(),
  filePath: z.string(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemoryPolicySchema = z.object({
  vectorEnabled: z.boolean().default(false),
  embeddingProvider: z.enum(["ollama"]).default("ollama"),
  embeddingModel: z.string().min(1).default("nomic-embed-text"),
  ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
  ftsWeight: z.number().min(0).max(1).default(0.6),
  vectorWeight: z.number().min(0).max(1).default(0.4),
  decayHalfLifeDays: z.number().min(1).max(3650).default(60),
  rollingSummaryEveryMessages: z.number().int().min(2).max(100).default(8),
});
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

export const MemorySearchQuerySchema = z.object({
  q: z.string().default(""),
  scope: MemoryScopeSchema.optional(),
  projectId: z.string().optional(),
  employeeId: z.string().optional(),
  status: MemoryStatusSchema.optional(),
  memoryType: MemoryTypeSchema.optional(),
  includeArchived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type MemorySearchQuery = z.infer<typeof MemorySearchQuerySchema>;

export const CreateMemoryNoteInputSchema = z.object({
  scope: MemoryScopeSchema,
  projectId: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  memoryType: MemoryTypeSchema.default("working"),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  sourceCitations: z.array(MemoryCitationSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  verifiedBy: MemoryVerificationSchema.default("unverified"),
  taintedByExternalInput: z.boolean().default(false),
  supersedesId: z.string().nullable().optional(),
});
export type CreateMemoryNoteInput = z.input<typeof CreateMemoryNoteInputSchema>;

export const PromoteMemoryInputSchema = z.object({
  targetType: z.enum(["semantic", "procedural"]),
  note: z.string().optional(),
});
export type PromoteMemoryInput = z.infer<typeof PromoteMemoryInputSchema>;

export const ResolveConflictInputSchema = z.object({
  resolution: z.enum(["keep_existing", "accept_new", "keep_both"]),
  note: z.string().optional(),
});
export type ResolveConflictInput = z.infer<typeof ResolveConflictInputSchema>;

export const VectorStatusSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["ollama"]),
  model: z.string(),
  ollamaBaseUrl: z.string(),
  ollamaReachable: z.boolean(),
  indexedCount: z.number().int().nonnegative(),
  totalActiveCount: z.number().int().nonnegative(),
  dimensions: z.number().int().nullable(),
  status: z.enum(["ready", "disabled", "ollama_unreachable", "needs_sync"]),
});
export type VectorStatus = z.infer<typeof VectorStatusSchema>;

export interface MemorySearchMeta {
  vectorUsed: boolean;
  vectorFallbackReason?: string;
}
