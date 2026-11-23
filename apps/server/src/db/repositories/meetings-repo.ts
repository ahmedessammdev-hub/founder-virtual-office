import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  MeetingActionItem,
  MeetingRecord,
  MeetingStatus,
  MeetingTurn,
  RunMode,
} from "@virtual-office/shared";

export class MeetingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    topic: string;
    agenda: string;
    projectId?: string | null;
    facilitatorEmployeeId: string;
    participantEmployeeIds: string[];
    maxRounds: number;
    mode: RunMode;
    autoCreateTasks: boolean;
    status?: MeetingStatus;
  }): MeetingRecord {
    const now = new Date().toISOString();
    const id = input.id ?? `meet-${crypto.randomUUID().slice(0, 12)}`;
    this.db
      .prepare(
        `INSERT INTO meetings (
          id, topic, agenda, project_id, facilitator_employee_id, participants_json,
          max_rounds, mode, auto_create_tasks, status, decisions_json, action_items_json,
          minutes_summary, created_at, updated_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.topic,
        input.agenda,
        input.projectId ?? null,
        input.facilitatorEmployeeId,
        JSON.stringify(input.participantEmployeeIds),
        input.maxRounds,
        input.mode,
        input.autoCreateTasks ? 1 : 0,
        input.status ?? "CREATED",
        "[]",
        "[]",
        null,
        now,
        now,
        null,
      );
    return this.getById(id)!;
  }

  public getById(id: string): MeetingRecord | null {
    const row = this.db
      .prepare("SELECT * FROM meetings WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const turnRows = this.db
      .prepare(
        "SELECT * FROM meeting_turns WHERE meeting_id = ? ORDER BY round ASC, turn_index ASC, rowid ASC",
      )
      .all(id) as Array<Record<string, unknown>>;

    return this.mapMeeting(
      row,
      turnRows.map((t) => this.mapTurn(t)),
    );
  }

  public list(limit = 50): MeetingRecord[] {
    const clamped = Math.min(Math.max(limit, 1), 200);
    const rows = this.db
      .prepare("SELECT * FROM meetings ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(clamped) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const id = String(row.id);
      const turnRows = this.db
        .prepare(
          "SELECT * FROM meeting_turns WHERE meeting_id = ? ORDER BY round ASC, turn_index ASC, rowid ASC",
        )
        .all(id) as Array<Record<string, unknown>>;
      return this.mapMeeting(
        row,
        turnRows.map((t) => this.mapTurn(t)),
      );
    });
  }

  public appendTurn(input: {
    meetingId: string;
    round: number;
    turnIndex: number;
    employeeId: string;
    runId?: string | null;
    summary: string;
    keyPoints?: string[];
  }): MeetingTurn {
    const now = new Date().toISOString();
    const turn: MeetingTurn = {
      id: `turn-${crypto.randomUUID().slice(0, 12)}`,
      meetingId: input.meetingId,
      round: input.round,
      turnIndex: input.turnIndex,
      employeeId: input.employeeId,
      runId: input.runId ?? null,
      summary: input.summary,
      keyPoints: input.keyPoints ?? [],
      createdAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO meeting_turns (
          id, meeting_id, round, turn_index, employee_id, run_id, summary, key_points_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id,
        turn.meetingId,
        turn.round,
        turn.turnIndex,
        turn.employeeId,
        turn.runId ?? null,
        turn.summary,
        JSON.stringify(turn.keyPoints),
        turn.createdAt,
      );

    this.db.prepare("UPDATE meetings SET updated_at = ? WHERE id = ?").run(now, turn.meetingId);
    return turn;
  }

  public update(
    id: string,
    patch: {
      status?: MeetingStatus;
      decisions?: string[];
      actionItems?: MeetingActionItem[];
      minutesSummary?: string | null;
      finishedAt?: string | null;
    },
  ): MeetingRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE meetings SET
           status = ?,
           decisions_json = ?,
           action_items_json = ?,
           minutes_summary = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? existing.status,
        JSON.stringify(patch.decisions ?? existing.decisions),
        JSON.stringify(patch.actionItems ?? existing.actionItems),
        patch.minutesSummary !== undefined
          ? patch.minutesSummary
          : existing.minutesSummary ?? null,
        now,
        patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt ?? null,
        id,
      );
    return this.getById(id);
  }

  private mapMeeting(row: Record<string, unknown>, turns: MeetingTurn[]): MeetingRecord {
    return {
      id: String(row.id),
      topic: String(row.topic),
      agenda: String(row.agenda ?? ""),
      projectId: row.project_id ? String(row.project_id) : null,
      facilitatorEmployeeId: String(row.facilitator_employee_id),
      participantEmployeeIds: JSON.parse(String(row.participants_json ?? "[]")) as string[],
      maxRounds: Number(row.max_rounds ?? 2),
      mode: String(row.mode) as RunMode,
      autoCreateTasks: Number(row.auto_create_tasks ?? 1) === 1,
      status: String(row.status) as MeetingStatus,
      turns,
      decisions: JSON.parse(String(row.decisions_json ?? "[]")) as string[],
      actionItems: JSON.parse(String(row.action_items_json ?? "[]")) as MeetingActionItem[],
      minutesSummary: row.minutes_summary ? String(row.minutes_summary) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    };
  }

  private mapTurn(row: Record<string, unknown>): MeetingTurn {
    return {
      id: String(row.id),
      meetingId: String(row.meeting_id),
      round: Number(row.round),
      turnIndex: Number(row.turn_index),
      employeeId: String(row.employee_id),
      runId: row.run_id ? String(row.run_id) : null,
      summary: String(row.summary),
      keyPoints: JSON.parse(String(row.key_points_json ?? "[]")) as string[],
      createdAt: String(row.created_at),
    };
  }
}
