import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  redactSecrets,
  type NormalizedAgentEvent,
  type RiskTier,
  type Run,
  type RunErrorCode,
  type RunMode,
  type RunStatus,
  type RuntimeProvider,
} from "@virtual-office/shared";

export interface StoredRunEvent {
  seq: number;
  runId: string;
  runSeq: number;
  eventType: string;
  event: NormalizedAgentEvent;
  createdAt: string;
}

export class RunsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    conversationId: string;
    employeeId: string;
    projectId?: string | null;
    taskId?: string | null;
    mode: RunMode;
    status: RunStatus;
    runtimeProvider: RuntimeProvider;
    model: string;
    riskTier: RiskTier;
    prompt: string;
    configSnapshot: Record<string, unknown>;
  }): Run {
    const now = new Date().toISOString();
    const run: Run = {
      id: input.id ?? crypto.randomUUID(),
      conversationId: input.conversationId,
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      mode: input.mode,
      status: input.status,
      runtimeProvider: input.runtimeProvider,
      model: input.model,
      riskTier: input.riskTier,
      prompt: redactSecrets(input.prompt),
      configSnapshot: input.configSnapshot,
      finalOutput: null,
      errorCode: null,
      errorMessage: null,
      worktreeBranch: null,
      worktreePath: null,
      diffStat: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO runs (
          id, conversation_id, employee_id, project_id, task_id, mode, status,
          runtime_provider, model, risk_tier, prompt, config_snapshot_json,
          cost_usd, input_tokens, output_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      )
      .run(
        run.id,
        run.conversationId,
        run.employeeId,
        run.projectId ?? null,
        run.taskId ?? null,
        run.mode,
        run.status,
        run.runtimeProvider,
        run.model,
        run.riskTier,
        run.prompt,
        JSON.stringify(run.configSnapshot),
        run.createdAt,
      );

    return run;
  }

  public getById(id: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRun(row) : null;
  }

  public listRecent(limit = 50): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRun(row));
  }

  public markStarted(runId: string, status: RunStatus = "RUNNING"): void {
    this.db
      .prepare("UPDATE runs SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?")
      .run(status, new Date().toISOString(), runId);
  }

  public updateStatus(
    runId: string,
    status: RunStatus,
    patch?: {
      finalOutput?: string | null;
      errorCode?: RunErrorCode | null;
      errorMessage?: string | null;
      worktreeBranch?: string | null;
      worktreePath?: string | null;
      diffStat?: string | null;
      finished?: boolean;
    },
  ): void {
    const finishedAt = patch?.finished ? new Date().toISOString() : null;
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?,
             final_output = COALESCE(?, final_output),
             error_code = COALESCE(?, error_code),
             error_message = COALESCE(?, error_message),
             worktree_branch = COALESCE(?, worktree_branch),
             worktree_path = COALESCE(?, worktree_path),
             diff_stat = COALESCE(?, diff_stat),
             finished_at = COALESCE(?, finished_at)
         WHERE id = ?`,
      )
      .run(
        status,
        patch?.finalOutput !== undefined && patch.finalOutput !== null
          ? redactSecrets(patch.finalOutput)
          : null,
        patch?.errorCode ?? null,
        patch?.errorMessage ? redactSecrets(patch.errorMessage) : null,
        patch?.worktreeBranch ?? null,
        patch?.worktreePath ?? null,
        patch?.diffStat ?? null,
        finishedAt,
        runId,
      );
  }

  public addUsage(runId: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.db
      .prepare(
        `UPDATE runs
         SET input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             cost_usd = cost_usd + ?
         WHERE id = ?`,
      )
      .run(inputTokens, outputTokens, costUsd, runId);
  }

  /**
   * Marks runs that were left active during an unexpected crash/shutdown as INTERRUPTED
   * so they can be inspected and resumed via their stored conversation/session ID.
   */
  public recoverInterruptedRuns(): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE runs
         SET status = 'INTERRUPTED',
             error_code = COALESCE(error_code, 'INTERNAL_ERROR'),
             error_message = COALESCE(error_message, 'Server restarted while run was active; resumable via session ID.'),
             finished_at = ?
         WHERE status IN ('QUEUED', 'PLANNING', 'RUNNING')`,
      )
      .run(now);
    return Number(res.changes);
  }

  public appendRunEvent(runId: string, runSeq: number, event: NormalizedAgentEvent): StoredRunEvent {
    const now = new Date().toISOString();
    const sanitizedJson = redactSecrets(JSON.stringify(event));
    const result = this.db
      .prepare(
        `INSERT INTO run_events (run_id, run_seq, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, runSeq, event.type, sanitizedJson, now);

    return {
      seq: Number(result.lastInsertRowid),
      runId,
      runSeq,
      eventType: event.type,
      event: JSON.parse(sanitizedJson) as NormalizedAgentEvent,
      createdAt: now,
    };
  }

  public getRunEventsAfter(runId: string, afterSeq = 0): StoredRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, run_id, run_seq, event_type, payload_json, created_at
         FROM run_events
         WHERE run_id = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(runId, afterSeq) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      seq: Number(row.seq),
      runId: String(row.run_id),
      runSeq: Number(row.run_seq),
      eventType: String(row.event_type),
      event: JSON.parse(String(row.payload_json)) as NormalizedAgentEvent,
      createdAt: String(row.created_at),
    }));
  }

  public getGlobalEventsAfter(afterSeq = 0, limit = 200): StoredRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, run_id, run_seq, event_type, payload_json, created_at
         FROM run_events
         WHERE seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(afterSeq, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      seq: Number(row.seq),
      runId: String(row.run_id),
      runSeq: Number(row.run_seq),
      eventType: String(row.event_type),
      event: JSON.parse(String(row.payload_json)) as NormalizedAgentEvent,
      createdAt: String(row.created_at),
    }));
  }

  private mapRun(row: Record<string, unknown>): Run {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      employeeId: String(row.employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      taskId: row.task_id ? String(row.task_id) : null,
      mode: String(row.mode) as RunMode,
      status: String(row.status) as RunStatus,
      runtimeProvider: String(row.runtime_provider) as RuntimeProvider,
      model: String(row.model),
      riskTier: String(row.risk_tier) as RiskTier,
      prompt: String(row.prompt),
      configSnapshot: JSON.parse(String(row.config_snapshot_json)) as Record<string, unknown>,
      finalOutput: row.final_output ? String(row.final_output) : null,
      errorCode: row.error_code ? (String(row.error_code) as RunErrorCode) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      worktreeBranch: row.worktree_branch ? String(row.worktree_branch) : null,
      worktreePath: row.worktree_path ? String(row.worktree_path) : null,
      diffStat: row.diff_stat ? String(row.diff_stat) : null,
      costUsd: Number(row.cost_usd ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    };
  }
}
