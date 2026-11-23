import type { DatabaseSync } from "node:sqlite";
import {
  normalizeForSearch,
  redactSecrets,
  type MemoryEntry,
  type MemoryScope,
  type MemoryStatus,
  type MemoryType,
  type MemoryVerification,
} from "@virtual-office/shared";

export interface MemoryVectorRow {
  entry: MemoryEntry;
  model: string;
  dimensions: number;
  contentSha256: string;
  vector: Float32Array;
}

export class MemoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  public getIndexedFileHash(filePath: string): string | null {
    const row = this.db
      .prepare("SELECT sha256 FROM indexed_files WHERE file_path = ?")
      .get(filePath) as { sha256: string } | undefined;
    return row ? row.sha256 : null;
  }

  public listIndexedFilePaths(): string[] {
    const rows = this.db.prepare("SELECT file_path FROM indexed_files").all() as Array<{
      file_path: string;
    }>;
    return rows.map((r) => r.file_path);
  }

  public upsertIndexedEntry(entry: MemoryEntry, fileSha256: string): void {
    const sanitizedContent = redactSecrets(entry.content);
    const normalizedTitle = normalizeForSearch(entry.title);
    const normalizedContent = normalizeForSearch(`${entry.title}\n${sanitizedContent}`);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO memory_entries (
          id, scope, project_id, employee_id, memory_type, title, content, citations_json,
          confidence, verified_by, decay_score, supersedes_id, tainted_by_external_input,
          status, conflict_with_id, conflict_reason, file_path, created_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          project_id = excluded.project_id,
          employee_id = excluded.employee_id,
          memory_type = excluded.memory_type,
          title = excluded.title,
          content = excluded.content,
          citations_json = excluded.citations_json,
          confidence = excluded.confidence,
          verified_by = excluded.verified_by,
          decay_score = excluded.decay_score,
          supersedes_id = excluded.supersedes_id,
          tainted_by_external_input = excluded.tainted_by_external_input,
          status = excluded.status,
          conflict_with_id = excluded.conflict_with_id,
          conflict_reason = excluded.conflict_reason,
          file_path = excluded.file_path,
          last_accessed_at = excluded.last_accessed_at`,
      )
      .run(
        entry.id,
        entry.scope,
        entry.projectId ?? null,
        entry.employeeId ?? null,
        entry.memoryType,
        entry.title,
        sanitizedContent,
        JSON.stringify(entry.sourceCitations),
        entry.confidence,
        entry.verifiedBy,
        entry.decayScore,
        entry.supersedesId ?? null,
        entry.taintedByExternalInput ? 1 : 0,
        entry.status ?? "active",
        entry.conflictWithId ?? null,
        entry.conflictReason ?? null,
        entry.filePath,
        entry.createdAt,
        entry.lastAccessedAt,
      );

    this.db.prepare("DELETE FROM memory_fts WHERE entry_id = ?").run(entry.id);
    this.db
      .prepare(
        `INSERT INTO memory_fts (entry_id, scope, project_id, employee_id, title, normalized_content)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.scope,
        entry.projectId ?? "",
        entry.employeeId ?? "",
        normalizedTitle,
        normalizedContent,
      );

    this.db
      .prepare(
        `INSERT INTO indexed_files (file_path, sha256, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET sha256 = excluded.sha256, updated_at = excluded.updated_at`,
      )
      .run(entry.filePath, fileSha256, now);
  }

  public removeByFilePath(filePath: string): void {
    const entries = this.db
      .prepare("SELECT id FROM memory_entries WHERE file_path = ?")
      .all(filePath) as Array<{ id: string }>;
    for (const entry of entries) {
      this.db.prepare("DELETE FROM memory_fts WHERE entry_id = ?").run(entry.id);
      this.db.prepare("DELETE FROM memory_vectors WHERE entry_id = ?").run(entry.id);
    }
    this.db.prepare("DELETE FROM memory_entries WHERE file_path = ?").run(filePath);
    this.db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
  }

  public getById(id: string): MemoryEntry | null {
    const row = this.db
      .prepare("SELECT * FROM memory_entries WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapEntry(row) : null;
  }

  public listAllActive(): MemoryEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memory_entries WHERE status = 'active' ORDER BY confidence DESC, last_accessed_at DESC",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapEntry(row));
  }

  public listActiveInScope(
    scope: MemoryScope,
    projectId?: string | null,
    employeeId?: string | null,
  ): MemoryEntry[] {
    if (scope === "project") {
      const rows = this.db
        .prepare(
          "SELECT * FROM memory_entries WHERE scope = 'project' AND project_id IS ? AND status = 'active'",
        )
        .all(projectId ?? null) as Array<Record<string, unknown>>;
      return rows.map((row) => this.mapEntry(row));
    }
    if (scope === "employee") {
      const rows = this.db
        .prepare(
          "SELECT * FROM memory_entries WHERE scope = 'employee' AND employee_id IS ? AND status = 'active'",
        )
        .all(employeeId ?? null) as Array<Record<string, unknown>>;
      return rows.map((row) => this.mapEntry(row));
    }
    const rows = this.db
      .prepare("SELECT * FROM memory_entries WHERE scope = 'company' AND status = 'active'")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapEntry(row));
  }

  public listConflicts(): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_entries WHERE status = 'conflict' ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapEntry(row));
  }

  public touchAccessed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE memory_entries SET last_accessed_at = ?, decay_score = MIN(1.0, MAX(decay_score, 0.85)) WHERE id = ?",
    );
    for (const id of ids) {
      stmt.run(now, id);
    }
  }

  public updateDecayScores(updates: Array<{ id: string; decayScore: number }>): void {
    if (updates.length === 0) return;
    const stmt = this.db.prepare("UPDATE memory_entries SET decay_score = ? WHERE id = ?");
    for (const u of updates) {
      stmt.run(u.decayScore, u.id);
    }
  }

  public upsertVector(
    entryId: string,
    model: string,
    dimensions: number,
    contentSha256: string,
    vectorFloat32: Float32Array,
  ): void {
    const blob = new Uint8Array(
      vectorFloat32.buffer,
      vectorFloat32.byteOffset,
      vectorFloat32.byteLength,
    );
    this.db
      .prepare(
        `INSERT INTO memory_vectors (entry_id, model, dimensions, content_sha256, vector_blob, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           model = excluded.model,
           dimensions = excluded.dimensions,
           content_sha256 = excluded.content_sha256,
           vector_blob = excluded.vector_blob,
           updated_at = excluded.updated_at`,
      )
      .run(entryId, model, dimensions, contentSha256, blob, new Date().toISOString());
  }

  public getVectorMeta(
    entryId: string,
  ): { model: string; dimensions: number; contentSha256: string } | null {
    const row = this.db
      .prepare("SELECT model, dimensions, content_sha256 FROM memory_vectors WHERE entry_id = ?")
      .get(entryId) as
      | { model: string; dimensions: number; content_sha256: string }
      | undefined;
    if (!row) return null;
    return {
      model: row.model,
      dimensions: Number(row.dimensions),
      contentSha256: row.content_sha256,
    };
  }

  public countVectors(model?: string): { count: number; dimensions: number | null } {
    if (model) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS cnt, MAX(dimensions) AS dims
           FROM memory_vectors v
           JOIN memory_entries m ON m.id = v.entry_id
           WHERE m.status = 'active' AND v.model = ?`,
        )
        .get(model) as { cnt: number; dims: number | null };
      return {
        count: Number(row?.cnt ?? 0),
        dimensions: row?.dims !== null && row?.dims !== undefined ? Number(row.dims) : null,
      };
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt, MAX(dimensions) AS dims
         FROM memory_vectors v
         JOIN memory_entries m ON m.id = v.entry_id
         WHERE m.status = 'active'`,
      )
      .get() as { cnt: number; dims: number | null };
    return {
      count: Number(row?.cnt ?? 0),
      dimensions: row?.dims !== null && row?.dims !== undefined ? Number(row.dims) : null,
    };
  }

  public deleteVectorsByModelMismatch(model: string): void {
    this.db.prepare("DELETE FROM memory_vectors WHERE model != ?").run(model);
  }

  public listVectorsForScope(params: {
    model: string;
    scope?: MemoryScope;
    projectId?: string;
    employeeId?: string;
    forEmployeeId?: string;
    forProjectId?: string | null;
    status?: MemoryStatus;
    memoryType?: MemoryType;
    includeArchived?: boolean;
  }): MemoryVectorRow[] {
    const { accessClauses, accessArgs } = this.buildAccessClauses(params);
    accessClauses.push("v.model = ?");
    accessArgs.push(params.model);

    const where = `WHERE ${accessClauses.join(" AND ")}`;
    const rows = this.db
      .prepare(
        `SELECT m.*, v.model AS vec_model, v.dimensions AS vec_dimensions,
                v.content_sha256 AS vec_sha256, v.vector_blob AS vec_blob
         FROM memory_vectors v
         JOIN memory_entries m ON m.id = v.entry_id
         ${where}`,
      )
      .all(...accessArgs) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const rawBlob = row.vec_blob as Uint8Array;
      const alignedBytes = new Uint8Array(rawBlob);
      const vector = new Float32Array(
        alignedBytes.buffer,
        alignedBytes.byteOffset,
        Math.floor(alignedBytes.byteLength / 4),
      );
      return {
        entry: this.mapEntry(row),
        model: String(row.vec_model),
        dimensions: Number(row.vec_dimensions),
        contentSha256: String(row.vec_sha256),
        vector,
      };
    });
  }

  private buildAccessClauses(params: {
    scope?: MemoryScope;
    projectId?: string;
    employeeId?: string;
    forEmployeeId?: string;
    forProjectId?: string | null;
    status?: MemoryStatus;
    memoryType?: MemoryType;
    includeArchived?: boolean;
  }): { accessClauses: string[]; accessArgs: Array<string | number> } {
    const accessClauses: string[] = [];
    const accessArgs: Array<string | number> = [];

    if (params.forEmployeeId !== undefined || params.forProjectId !== undefined) {
      const allowedParts: string[] = ["m.scope = 'company'"];
      if (params.forProjectId) {
        allowedParts.push("(m.scope = 'project' AND m.project_id = ?)");
        accessArgs.push(params.forProjectId);
      }
      if (params.forEmployeeId) {
        allowedParts.push("(m.scope = 'employee' AND m.employee_id = ?)");
        accessArgs.push(params.forEmployeeId);
      }
      accessClauses.push(`(${allowedParts.join(" OR ")})`);
      // Runtime context retrieval ALWAYS restricts strictly to active memories
      accessClauses.push("m.status = 'active'");
    } else if (params.status) {
      accessClauses.push("m.status = ?");
      accessArgs.push(params.status);
    } else if (!params.includeArchived) {
      accessClauses.push("m.status = 'active'");
    }

    if (params.scope) {
      accessClauses.push("m.scope = ?");
      accessArgs.push(params.scope);
    }
    if (params.projectId) {
      accessClauses.push("m.project_id = ?");
      accessArgs.push(params.projectId);
    }
    if (params.employeeId) {
      accessClauses.push("m.employee_id = ?");
      accessArgs.push(params.employeeId);
    }
    if (params.memoryType) {
      accessClauses.push("m.memory_type = ?");
      accessArgs.push(params.memoryType);
    }

    return { accessClauses, accessArgs };
  }

  /**
   * Searches normalized Arabic/English memory with strict scope isolation:
   * - If `forEmployeeId` / `forProjectId` are supplied, returns ONLY active company-wide,
   *   that project's memory, and that employee's memory (preventing cross-project/cross-employee leakage
   *   and hiding unverified conflicts/superseded entries from runtime prompts).
   */
  public search(params: {
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
  }): MemoryEntry[] {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
    const normalizedQuery = normalizeForSearch(params.q);

    const { accessClauses, accessArgs } = this.buildAccessClauses(params);
    const whereAccess = accessClauses.length > 0 ? `AND ${accessClauses.join(" AND ")}` : "";

    const tokens = normalizedQuery
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      const cleanWhere =
        accessClauses.length > 0 ? `WHERE ${accessClauses.join(" AND ")}` : "";
      const rows = this.db
        .prepare(
          `SELECT m.* FROM memory_entries m ${cleanWhere}
           ORDER BY (m.confidence * m.decay_score) DESC, m.last_accessed_at DESC
           LIMIT ?`,
        )
        .all(...accessArgs, limit) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        ...this.mapEntry(row),
        retrievalMode: "recent" as const,
      }));
    }

    const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT m.*
         FROM memory_fts f
         JOIN memory_entries m ON m.id = f.entry_id
         WHERE memory_fts MATCH ?
         ${whereAccess}
         ORDER BY bm25(memory_fts) ASC, (m.confidence * m.decay_score) DESC
         LIMIT ?`,
      )
      .all(ftsQuery, ...accessArgs, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...this.mapEntry(row),
      retrievalMode: "fts" as const,
    }));
  }

  private mapEntry(row: Record<string, unknown>): MemoryEntry {
    const confidence = Number(row.confidence ?? 0.5);
    const decayScore = Number(row.decay_score ?? 1.0);
    return {
      id: String(row.id),
      scope: String(row.scope) as MemoryScope,
      projectId: row.project_id ? String(row.project_id) : null,
      employeeId: row.employee_id ? String(row.employee_id) : null,
      memoryType: String(row.memory_type) as MemoryType,
      title: String(row.title),
      content: String(row.content),
      sourceCitations: JSON.parse(String(row.citations_json ?? "[]")) as MemoryEntry["sourceCitations"],
      confidence,
      verifiedBy: String(row.verified_by) as MemoryVerification,
      createdAt: String(row.created_at),
      lastAccessedAt: String(row.last_accessed_at),
      decayScore,
      supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
      taintedByExternalInput: Number(row.tainted_by_external_input ?? 0) === 1,
      status: (row.status ? String(row.status) : "active") as MemoryStatus,
      conflictWithId: row.conflict_with_id ? String(row.conflict_with_id) : null,
      conflictReason: row.conflict_reason ? String(row.conflict_reason) : null,
      effectiveScore: Number(Math.min(1, Math.max(0, confidence * decayScore)).toFixed(4)),
      filePath: String(row.file_path),
    };
  }
}
