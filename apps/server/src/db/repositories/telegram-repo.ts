import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redactSecrets, type TelegramMessageRecord } from "@virtual-office/shared";

export class TelegramRepository {
  constructor(private readonly db: DatabaseSync) {}

  public logMessage(input: {
    chatId: string;
    direction: "inbound" | "outbound";
    text: string;
    linkedRunId?: string | null;
    linkedApprovalId?: string | null;
  }): TelegramMessageRecord {
    const id = `tg-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const safeText = redactSecrets(input.text);
    this.db
      .prepare(
        `INSERT INTO telegram_messages (id, chat_id, direction, text, linked_run_id, linked_approval_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.chatId,
        input.direction,
        safeText,
        input.linkedRunId ?? null,
        input.linkedApprovalId ?? null,
        now,
      );
    return {
      id,
      chatId: input.chatId,
      direction: input.direction,
      text: safeText,
      linkedRunId: input.linkedRunId ?? null,
      linkedApprovalId: input.linkedApprovalId ?? null,
      createdAt: now,
    };
  }

  public listRecent(limit = 50): TelegramMessageRecord[] {
    const clamped = Math.min(Math.max(limit, 1), 200);
    const rows = this.db
      .prepare("SELECT * FROM telegram_messages ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(clamped) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      chatId: String(row.chat_id),
      direction: String(row.direction) as "inbound" | "outbound",
      text: String(row.text),
      linkedRunId: row.linked_run_id ? String(row.linked_run_id) : null,
      linkedApprovalId: row.linked_approval_id ? String(row.linked_approval_id) : null,
      createdAt: String(row.created_at),
    }));
  }

  public findInboundRunChatId(runId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT chat_id FROM telegram_messages WHERE linked_run_id = ? AND direction = 'inbound' ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId) as { chat_id: string } | undefined;
    return row ? row.chat_id : null;
  }
}
