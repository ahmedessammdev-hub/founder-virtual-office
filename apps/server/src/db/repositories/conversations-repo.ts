import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redactSecrets } from "@virtual-office/shared";

export interface ConversationRecord {
  id: string;
  employeeId: string;
  projectId: string | null;
  title: string | null;
  externalSessionId: string | null;
  runtimeProvider: string | null;
  rollingSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export class ConversationsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    employeeId: string;
    projectId?: string | null;
    title?: string | null;
    runtimeProvider?: string | null;
  }): ConversationRecord {
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id: input.id ?? crypto.randomUUID(),
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      title: input.title ?? null,
      externalSessionId: null,
      runtimeProvider: input.runtimeProvider ?? null,
      rollingSummary: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO conversations (
          id, employee_id, project_id, title, external_session_id, runtime_provider, rolling_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.employeeId,
        record.projectId,
        record.title,
        record.externalSessionId,
        record.runtimeProvider,
        record.rollingSummary,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  public getById(id: string): ConversationRecord | null {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapConversation(row) : null;
  }

  public listByEmployee(employeeId: string, limit = 25): ConversationRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM conversations WHERE employee_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(employeeId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapConversation(r));
  }

  public updateExternalSession(
    conversationId: string,
    sessionId: string,
    provider: string,
  ): void {
    this.db
      .prepare(
        "UPDATE conversations SET external_session_id = ?, runtime_provider = ?, updated_at = ? WHERE id = ?",
      )
      .run(sessionId, provider, new Date().toISOString(), conversationId);
  }

  public updateRollingSummary(conversationId: string, summary: string): void {
    this.db
      .prepare("UPDATE conversations SET rolling_summary = ?, updated_at = ? WHERE id = ?")
      .run(redactSecrets(summary), new Date().toISOString(), conversationId);
  }

  public appendMessage(input: {
    conversationId: string;
    runId?: string | null;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown> | null;
  }): MessageRecord {
    const now = new Date().toISOString();
    const record: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      role: input.role,
      content: redactSecrets(input.content),
      metadata: input.metadata ?? null,
      createdAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, run_id, role, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.conversationId,
        record.runId,
        record.role,
        record.content,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt,
      );

    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, record.conversationId);

    return record;
  }

  public listMessages(conversationId: string, limit = 50): MessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
          SELECT *, rowid AS _rid FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
        ) ORDER BY created_at ASC, _rid ASC`,
      )
      .all(conversationId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversation_id),
      runId: row.run_id ? String(row.run_id) : null,
      role: String(row.role) as MessageRecord["role"],
      content: String(row.content),
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : null,
      createdAt: String(row.created_at),
    }));
  }

  private mapConversation(row: Record<string, unknown>): ConversationRecord {
    return {
      id: String(row.id),
      employeeId: String(row.employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      title: row.title ? String(row.title) : null,
      externalSessionId: row.external_session_id ? String(row.external_session_id) : null,
      runtimeProvider: row.runtime_provider ? String(row.runtime_provider) : null,
      rollingSummary: row.rolling_summary ? String(row.rolling_summary) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
