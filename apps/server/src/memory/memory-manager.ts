import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  CreateMemoryNoteInputSchema,
  MemoryPolicySchema,
  redactSecrets,
  type CreateMemoryNoteInput,
  type MemoryEntry,
  type MemoryPolicy,
  type MemoryScope,
  type MemorySearchMeta,
  type MemoryStatus,
  type MemoryType,
  type MemoryVerification,
  type PromoteMemoryInput,
  type ResolveConflictInput,
  type VectorStatus,
} from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryIndexer } from "../company/memory-indexer.js";
import { assertPathWithinRoots } from "../company/path-guard.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import { computeEffectiveDecay, detectMemoryConflict } from "./decay-and-conflict.js";
import type { VectorStore } from "./vector-store.js";

function slugifyMemoryId(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || `note-${Date.now().toString(36)}`;
}

export function serializeMemoryMarkdown(entry: MemoryEntry): string {
  const frontmatter: Record<string, unknown> = {
    id: entry.id,
    scope: entry.scope,
    memoryType: entry.memoryType,
    title: entry.title,
    confidence: entry.confidence,
    verifiedBy: entry.verifiedBy,
    status: entry.status,
    createdAt: entry.createdAt,
    lastAccessedAt: entry.lastAccessedAt,
    decayScore: entry.decayScore,
    taintedByExternalInput: entry.taintedByExternalInput,
    sourceCitations: entry.sourceCitations,
  };
  if (entry.projectId) {
    frontmatter.projectId = entry.projectId;
  }
  if (entry.employeeId) {
    frontmatter.employeeId = entry.employeeId;
  }
  if (entry.supersedesId) {
    frontmatter.supersedesId = entry.supersedesId;
  }
  if (entry.conflictWithId) {
    frontmatter.conflictWithId = entry.conflictWithId;
  }
  if (entry.conflictReason) {
    frontmatter.conflictReason = entry.conflictReason;
  }

  const sanitizedBody = redactSecrets(entry.content).trim();
  const yamlBlock = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlBlock}\n---\n${sanitizedBody}\n`;
}

/**
 * Enforces the evidence-first invariant:
 * - Unverified conclusions NEVER auto-promote into semantic/procedural truth (forced to working, conf <= 0.50).
 * - Externally tainted data without explicit human review is forced to working, conf <= 0.45.
 * - `tool_output` entries require at least one real tool citation (command/file/run) or downgrade to unverified.
 */
export function enforceVerificationInvariant(input: {
  memoryType: MemoryType;
  verifiedBy: MemoryVerification;
  confidence: number;
  taintedByExternalInput: boolean;
  sourceCitations: MemoryEntry["sourceCitations"];
}): {
  memoryType: MemoryType;
  verifiedBy: MemoryVerification;
  confidence: number;
} {
  let memoryType = input.memoryType;
  let verifiedBy = input.verifiedBy;
  let confidence = input.confidence;

  if (verifiedBy === "tool_output") {
    const hasToolCitation = input.sourceCitations.some(
      (c) => c.kind === "command" || c.kind === "file" || c.kind === "run",
    );
    if (!hasToolCitation) {
      verifiedBy = "unverified";
    }
  }

  if (verifiedBy === "unverified") {
    memoryType = "working";
    confidence = Math.min(confidence, 0.5);
  }

  if (input.taintedByExternalInput && verifiedBy !== "human") {
    memoryType = "working";
    confidence = Math.min(confidence, 0.45);
  }

  return {
    memoryType,
    verifiedBy,
    confidence: Number(Math.min(Math.max(confidence, 0), 1).toFixed(4)),
  };
}

export class MemoryManager {
  constructor(
    private readonly companyStore: CompanyStore,
    private readonly memoryRepo: MemoryRepository,
    private readonly memoryIndexer: MemoryIndexer,
    private readonly vectorStore: VectorStore,
    private readonly auditRepo: AuditRepository,
  ) {}

  public getMemoryPolicy(): MemoryPolicy {
    return this.companyStore.getCompanyConfig().memory ?? MemoryPolicySchema.parse({});
  }

  public async search(params: {
    q: string;
    scope?: MemoryScope;
    projectId?: string;
    employeeId?: string;
    forEmployeeId?: string;
    forProjectId?: string | null;
    status?: MemoryStatus;
    memoryType?: MemoryType;
    includeArchived?: boolean;
    limit?: number;
  }): Promise<{ entries: MemoryEntry[]; meta: MemorySearchMeta }> {
    return this.vectorStore.hybridSearch(params, this.getMemoryPolicy());
  }

  public touchAccessed(ids: string[]): void {
    this.memoryRepo.touchAccessed(ids);
  }

  public async writeMemoryEntry(
    rawInput: CreateMemoryNoteInput,
    opts?: { strictTypeCheck?: boolean },
  ): Promise<{
    entry: MemoryEntry;
    conflictDetected: boolean;
    conflictingEntry: MemoryEntry | null;
  }> {
    const input = CreateMemoryNoteInputSchema.parse(rawInput);

    if (input.scope === "project" && !input.projectId) {
      throw new Error("projectId is required when writing project-scoped memory.");
    }
    if (input.scope === "employee" && !input.employeeId) {
      throw new Error("employeeId is required when writing employee-scoped memory.");
    }

    if (opts?.strictTypeCheck) {
      if (
        (input.memoryType === "semantic" || input.memoryType === "procedural") &&
        input.verifiedBy === "unverified"
      ) {
        throw new Error(
          "Evidence invariant violated: unverified conclusions cannot be written directly as semantic/procedural memory.",
        );
      }
      if (
        (input.memoryType === "semantic" || input.memoryType === "procedural") &&
        input.taintedByExternalInput &&
        input.verifiedBy !== "human"
      ) {
        throw new Error(
          "Evidence invariant violated: externally tainted content requires human verification before promotion.",
        );
      }
      if (
        input.verifiedBy === "tool_output" &&
        !input.sourceCitations.some(
          (c) => c.kind === "command" || c.kind === "file" || c.kind === "run",
        )
      ) {
        throw new Error(
          "Evidence invariant violated: tool_output memory requires at least one command, file, or run citation.",
        );
      }
    }

    const enforced = enforceVerificationInvariant({
      memoryType: input.memoryType,
      verifiedBy: input.verifiedBy,
      confidence: input.confidence,
      taintedByExternalInput: input.taintedByExternalInput,
      sourceCitations: input.sourceCitations,
    });

    const memoryDir = this.resolveMemoryDirectory(input.scope, input.projectId, input.employeeId);
    fs.mkdirSync(memoryDir, { recursive: true });

    const shortId = crypto.randomBytes(3).toString("hex");
    const slug = slugifyMemoryId(input.title);
    const id = `${input.scope}-${slug}-${shortId}`;
    const filePath = assertPathWithinRoots(path.join(memoryDir, `${slug}-${shortId}.md`), [
      this.companyStore.companyRoot,
    ]);

    const now = new Date().toISOString();
    const existingActive = this.memoryRepo.listActiveInScope(
      input.scope,
      input.projectId,
      input.employeeId,
    );
    const conflict = detectMemoryConflict(
      {
        id,
        scope: input.scope,
        projectId: input.projectId ?? null,
        employeeId: input.employeeId ?? null,
        title: input.title,
        content: input.content,
        supersedesId: input.supersedesId ?? null,
      },
      existingActive,
    );

    const entry: MemoryEntry = {
      id,
      scope: input.scope,
      projectId: input.projectId ?? null,
      employeeId: input.employeeId ?? null,
      memoryType: enforced.memoryType,
      title: input.title,
      content: redactSecrets(input.content),
      sourceCitations: input.sourceCitations,
      confidence: enforced.confidence,
      verifiedBy: enforced.verifiedBy,
      createdAt: now,
      lastAccessedAt: now,
      decayScore: 1.0,
      supersedesId: input.supersedesId ?? null,
      taintedByExternalInput: input.taintedByExternalInput,
      status: conflict ? "conflict" : "active",
      conflictWithId: conflict ? conflict.conflictingEntry.id : null,
      conflictReason: conflict ? conflict.reason : null,
      filePath,
    };

    atomicWriteFile(filePath, serializeMemoryMarkdown(entry));
    this.memoryIndexer.indexSingleFile(filePath);
    const saved = this.memoryRepo.getById(id) ?? entry;

    if (conflict) {
      this.auditRepo.log({
        actorType: "system",
        actorId: "memory-manager",
        action: "memory.conflict_detected",
        targetType: "memory",
        targetId: saved.id,
        status: "CONFLICT",
        details: {
          conflictingEntryId: conflict.conflictingEntry.id,
          reason: conflict.reason,
        },
      });
    } else {
      await this.vectorStore.embedEntry(saved, this.getMemoryPolicy()).catch(() => false);
      this.auditRepo.log({
        actorType: saved.verifiedBy === "human" ? "human" : "system",
        actorId: saved.verifiedBy === "human" ? "founder" : "memory-manager",
        action: "memory.note_created",
        targetType: "memory",
        targetId: saved.id,
        status: "OK",
        details: {
          scope: saved.scope,
          memoryType: saved.memoryType,
          verifiedBy: saved.verifiedBy,
        },
      });
    }

    return {
      entry: saved,
      conflictDetected: Boolean(conflict),
      conflictingEntry: conflict?.conflictingEntry ?? null,
    };
  }

  public async promoteMemoryEntry(
    id: string,
    input: PromoteMemoryInput,
  ): Promise<{
    entry: MemoryEntry;
    conflictDetected: boolean;
    conflictingEntry: MemoryEntry | null;
  }> {
    const existing = this.memoryRepo.getById(id);
    if (!existing) {
      throw new Error(`Memory entry "${id}" not found.`);
    }
    if (existing.status === "superseded" || existing.status === "archived") {
      throw new Error(`Cannot promote memory "${id}" with status "${existing.status}".`);
    }

    assertPathWithinRoots(existing.filePath, [this.companyStore.companyRoot]);
    const now = new Date().toISOString();

    const activeSameScope = this.memoryRepo.listActiveInScope(
      existing.scope,
      existing.projectId,
      existing.employeeId,
    );
    const conflict = detectMemoryConflict(existing, activeSameScope);

    const updated: MemoryEntry = {
      ...existing,
      memoryType: input.targetType,
      verifiedBy: "human",
      confidence: Math.max(existing.confidence, 0.9),
      taintedByExternalInput: false,
      lastAccessedAt: now,
      decayScore: 1.0,
      status: conflict ? "conflict" : "active",
      conflictWithId: conflict ? conflict.conflictingEntry.id : null,
      conflictReason: conflict ? conflict.reason : null,
      sourceCitations: [
        ...existing.sourceCitations,
        {
          kind: "human",
          ref: "founder-promotion",
          summary: input.note?.trim() || `Promoted to verified ${input.targetType}`,
        },
      ],
    };

    atomicWriteFile(updated.filePath, serializeMemoryMarkdown(updated));
    this.memoryIndexer.indexSingleFile(updated.filePath);
    const saved = this.memoryRepo.getById(id) ?? updated;

    if (!conflict) {
      await this.vectorStore.embedEntry(saved, this.getMemoryPolicy()).catch(() => false);
    }

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: conflict ? "memory.promotion_conflict" : "memory.promoted",
      targetType: "memory",
      targetId: saved.id,
      status: conflict ? "CONFLICT" : "OK",
      details: {
        targetType: input.targetType,
        conflictWithId: conflict?.conflictingEntry.id ?? null,
      },
    });

    return {
      entry: saved,
      conflictDetected: Boolean(conflict),
      conflictingEntry: conflict?.conflictingEntry ?? null,
    };
  }

  public async resolveConflict(
    conflictEntryId: string,
    input: ResolveConflictInput,
  ): Promise<{ resolvedEntry: MemoryEntry; supersededEntry: MemoryEntry | null }> {
    const candidate = this.memoryRepo.getById(conflictEntryId);
    if (!candidate) {
      throw new Error(`Memory entry "${conflictEntryId}" not found.`);
    }
    if (candidate.status !== "conflict") {
      throw new Error(`Memory entry "${conflictEntryId}" is not currently in conflict status.`);
    }

    assertPathWithinRoots(candidate.filePath, [this.companyStore.companyRoot]);
    const existing = candidate.conflictWithId
      ? this.memoryRepo.getById(candidate.conflictWithId)
      : null;

    const now = new Date().toISOString();
    let supersededEntry: MemoryEntry | null = null;

    if (input.resolution === "keep_existing") {
      const updatedCandidate: MemoryEntry = {
        ...candidate,
        status: "superseded",
        conflictWithId: null,
        conflictReason: input.note?.trim()
          ? `Rejected in favor of existing fact: ${input.note.trim()}`
          : candidate.conflictReason,
        lastAccessedAt: now,
      };
      atomicWriteFile(updatedCandidate.filePath, serializeMemoryMarkdown(updatedCandidate));
      this.memoryIndexer.indexSingleFile(updatedCandidate.filePath);
    } else if (input.resolution === "accept_new") {
      if (existing) {
        assertPathWithinRoots(existing.filePath, [this.companyStore.companyRoot]);
        const updatedOld: MemoryEntry = {
          ...existing,
          status: "superseded",
          lastAccessedAt: now,
        };
        atomicWriteFile(updatedOld.filePath, serializeMemoryMarkdown(updatedOld));
        this.memoryIndexer.indexSingleFile(updatedOld.filePath);
        supersededEntry = this.memoryRepo.getById(existing.id) ?? updatedOld;
      }

      const promotedNew: MemoryEntry = {
        ...candidate,
        status: "active",
        conflictWithId: null,
        conflictReason: null,
        supersedesId: existing?.id ?? candidate.supersedesId ?? null,
        verifiedBy: "human",
        memoryType: candidate.memoryType === "working" ? "semantic" : candidate.memoryType,
        confidence: Math.max(candidate.confidence, 0.9),
        taintedByExternalInput: false,
        decayScore: 1.0,
        lastAccessedAt: now,
        sourceCitations: [
          ...candidate.sourceCitations,
          {
            kind: "human",
            ref: "conflict-resolution:accept_new",
            summary: input.note?.trim() || "Accepted by founder over conflicting entry",
          },
        ],
      };
      atomicWriteFile(promotedNew.filePath, serializeMemoryMarkdown(promotedNew));
      this.memoryIndexer.indexSingleFile(promotedNew.filePath);
    } else {
      const activatedNew: MemoryEntry = {
        ...candidate,
        status: "active",
        conflictWithId: null,
        conflictReason: null,
        verifiedBy: "human",
        memoryType: candidate.memoryType === "working" ? "semantic" : candidate.memoryType,
        confidence: Math.max(candidate.confidence, 0.85),
        taintedByExternalInput: false,
        decayScore: 1.0,
        lastAccessedAt: now,
        sourceCitations: [
          ...candidate.sourceCitations,
          {
            kind: "human",
            ref: "conflict-resolution:keep_both",
            summary: input.note?.trim() || "Verified alongside existing entry",
          },
        ],
      };
      atomicWriteFile(activatedNew.filePath, serializeMemoryMarkdown(activatedNew));
      this.memoryIndexer.indexSingleFile(activatedNew.filePath);
    }

    const resolvedEntry = this.memoryRepo.getById(conflictEntryId)!;
    if (resolvedEntry.status === "active") {
      await this.vectorStore.embedEntry(resolvedEntry, this.getMemoryPolicy()).catch(() => false);
    }

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "memory.conflict_resolved",
      targetType: "memory",
      targetId: conflictEntryId,
      status: "OK",
      details: {
        resolution: input.resolution,
        supersededId: supersededEntry?.id ?? null,
        note: input.note ?? null,
      },
    });

    return { resolvedEntry, supersededEntry };
  }

  public recalculateAllDecay(nowMs = Date.now()): { updated: number } {
    const policy = this.getMemoryPolicy();
    const active = this.memoryRepo.listAllActive();
    const updates = active.map((entry) => ({
      id: entry.id,
      decayScore: computeEffectiveDecay(entry, policy.decayHalfLifeDays, nowMs),
    }));
    this.memoryRepo.updateDecayScores(updates);
    this.auditRepo.log({
      actorType: "system",
      actorId: "memory-manager",
      action: "memory.decay_recalculated",
      targetType: "memory",
      targetId: "all",
      status: "OK",
      details: { count: updates.length, halfLifeDays: policy.decayHalfLifeDays },
    });
    return { updated: updates.length };
  }

  public async getVectorStatus(): Promise<VectorStatus> {
    return this.vectorStore.getStatus(this.getMemoryPolicy());
  }

  public async syncVectors(): Promise<{
    embedded: number;
    skipped: number;
    failed: number;
    error?: string;
  }> {
    return this.vectorStore.syncEmbeddings(this.getMemoryPolicy());
  }

  private resolveMemoryDirectory(
    scope: MemoryScope,
    projectId?: string | null,
    employeeId?: string | null,
  ): string {
    if (scope === "project") {
      if (!projectId) throw new Error("projectId required");
      return assertPathWithinRoots(
        path.join(this.companyStore.companyRoot, "projects", projectId, "memory"),
        [path.join(this.companyStore.companyRoot, "projects")],
      );
    }
    if (scope === "employee") {
      if (!employeeId) throw new Error("employeeId required");
      return assertPathWithinRoots(
        path.join(this.companyStore.companyRoot, "employees", employeeId, "memory"),
        [path.join(this.companyStore.companyRoot, "employees")],
      );
    }
    return assertPathWithinRoots(path.join(this.companyStore.companyRoot, "memory"), [
      this.companyStore.companyRoot,
    ]);
  }
}
