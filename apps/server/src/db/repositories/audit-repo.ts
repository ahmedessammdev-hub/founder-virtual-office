import type { DatabaseSync } from "node:sqlite";
import { redactSecrets } from "@virtual-office/shared";

export interface AuditLogEntry {
  id: number;
  actorType: "human" | "employee" | "system";
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export class AuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  public log(input: {
    actorType: AuditLogEntry["actorType"];
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    status: string;
    details?: Record<string, unknown> | null;
  }): AuditLogEntry {
    const now = new Date().toISOString();
    const redactedDetails = input.details
      ? redactSecrets(JSON.stringify(input.details))
      : null;

    const result = this.db
      .prepare(
        `INSERT INTO audit_logs (
          actor_type, actor_id, action, target_type, target_id, status, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actorType,
        input.actorId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.status,
        redactedDetails,
        now,
      );

    return {
      id: Number(result.lastInsertRowid),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      status: input.status,
      details: redactedDetails ? (JSON.parse(redactedDetails) as Record<string, unknown>) : null,
      createdAt: now,
    };
  }

  private mapRow(row: Record<string, unknown>): AuditLogEntry {
    return {
      id: Number(row.id),
      actorType: String(row.actor_type) as AuditLogEntry["actorType"],
      actorId: String(row.actor_id),
      action: String(row.action),
      targetType: row.target_type ? String(row.target_type) : null,
      targetId: row.target_id ? String(row.target_id) : null,
      status: String(row.status),
      details: row.details_json
        ? (JSON.parse(String(row.details_json)) as Record<string, unknown>)
        : null,
      createdAt: String(row.created_at),
    };
  }

  public listRecent(limit = 100): AuditLogEntry[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = this.db
      .prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?")
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRow(row));
  }

  public listFiltered(opts?: {
    limit?: number;
    actorType?: string;
    status?: string;
    actionQuery?: string;
  }): AuditLogEntry[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 100)));
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (opts?.actorType?.trim()) {
      clauses.push("actor_type = ?");
      params.push(opts.actorType.trim());
    }
    if (opts?.status?.trim()) {
      clauses.push("status = ?");
      params.push(opts.status.trim());
    }
    if (opts?.actionQuery?.trim()) {
      const q = `%${opts.actionQuery.trim().toLowerCase()}%`;
      clauses.push(
        "(LOWER(action) LIKE ? OR LOWER(COALESCE(target_id, '')) LIKE ? OR LOWER(COALESCE(actor_id, '')) LIKE ? OR LOWER(COALESCE(details_json, '')) LIKE ?)",
      );
      params.push(q, q, q, q);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRow(row));
  }
}

function sanitizeCsvCell(raw: string): string {
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (safe.includes('"') || safe.includes(",") || safe.includes("\n") || safe.includes("\r")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Formats audit entries into RFC-4180 CSV with formula-injection neutralization.
 */
export function formatAuditLogsCsv(entries: AuditLogEntry[]): string {
  const header = "id,created_at,actor_type,actor_id,action,target_type,target_id,status,details";
  const lines = entries.map((entry) =>
    [
      String(entry.id),
      entry.createdAt,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.targetType ?? "",
      entry.targetId ?? "",
      entry.status,
      entry.details ? JSON.stringify(entry.details) : "",
    ]
      .map(sanitizeCsvCell)
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}
