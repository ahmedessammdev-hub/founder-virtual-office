import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  redactSecrets,
  type ApprovalRequest,
  type ApprovalStatus,
  type PreconditionSnapshot,
  type RiskTier,
} from "@virtual-office/shared";

export class ApprovalsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    runId?: string | null;
    taskId?: string | null;
    employeeId: string;
    projectId?: string | null;
    actionType: string;
    riskTier: RiskTier;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    preconditionSnapshot?: PreconditionSnapshot | null;
    diffPreview?: string | null;
    idempotencyKey: string;
    taintedByExternalInput?: boolean;
    expiresAt: string;
  }): ApprovalRequest {
    const existing = this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: ApprovalRequest = {
      id: input.id ?? crypto.randomUUID(),
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      actionType: input.actionType,
      riskTier: input.riskTier,
      title: redactSecrets(input.title),
      summary: redactSecrets(input.summary),
      payload: JSON.parse(redactSecrets(JSON.stringify(input.payload))) as Record<string, unknown>,
      payloadHash: input.payloadHash,
      preconditionSnapshot: input.preconditionSnapshot ?? null,
      diffPreview: input.diffPreview ? redactSecrets(input.diffPreview) : null,
      idempotencyKey: input.idempotencyKey,
      taintedByExternalInput: Boolean(input.taintedByExternalInput),
      status: "PENDING",
      decisionNote: null,
      executionResult: null,
      expiresAt: input.expiresAt,
      createdAt: now,
      decidedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO approvals (
          id, run_id, task_id, employee_id, project_id, action_type, risk_tier,
          title, summary, payload_json, payload_hash, precondition_json, diff_preview,
          idempotency_key, tainted_by_external_input, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.runId ?? null,
        record.taskId ?? null,
        record.employeeId,
        record.projectId ?? null,
        record.actionType,
        record.riskTier,
        record.title,
        record.summary,
        JSON.stringify(record.payload),
        record.payloadHash,
        record.preconditionSnapshot ? JSON.stringify(record.preconditionSnapshot) : null,
        record.diffPreview ?? null,
        record.idempotencyKey,
        record.taintedByExternalInput ? 1 : 0,
        record.status,
        record.expiresAt,
        record.createdAt,
      );

    return record;
  }

  public getById(id: string): ApprovalRequest | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapApproval(row) : null;
  }

  public getByIdempotencyKey(key: string): ApprovalRequest | null {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE idempotency_key = ?")
      .get(key) as Record<string, unknown> | undefined;
    return row ? this.mapApproval(row) : null;
  }

  public list(status?: ApprovalStatus): ApprovalRequest[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC")
          .all(status) as Array<Record<string, unknown>>)
      : (this.db
          .prepare("SELECT * FROM approvals ORDER BY created_at DESC")
          .all() as Array<Record<string, unknown>>);
    return rows.map((row) => this.mapApproval(row));
  }

  /**
   * Atomically transitions a PENDING approval to APPROVED, REJECTED, or EXPIRED.
   * Returns `updated: false` on concurrent double-approve/decide so actions never execute twice.
   */
  public decidePendingApproval(
    id: string,
    targetStatus: "APPROVED" | "REJECTED" | "EXPIRED",
    note?: string,
  ): { updated: boolean; approval: ApprovalRequest | null } {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE approvals
         SET status = ?, decision_note = COALESCE(?, decision_note), decided_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(targetStatus, note ?? null, now, id);

    return {
      updated: Number(res.changes) === 1,
      approval: this.getById(id),
    };
  }

  public markExecuted(
    id: string,
    finalStatus: "EXECUTED" | "FAILED",
    executionResult: Record<string, unknown>,
  ): void {
    this.db
      .prepare("UPDATE approvals SET status = ?, execution_result_json = ? WHERE id = ?")
      .run(finalStatus, redactSecrets(JSON.stringify(executionResult)), id);
  }

  private mapApproval(row: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(row.id),
      runId: row.run_id ? String(row.run_id) : null,
      taskId: row.task_id ? String(row.task_id) : null,
      employeeId: String(row.employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      actionType: String(row.action_type),
      riskTier: String(row.risk_tier) as RiskTier,
      title: String(row.title),
      summary: String(row.summary),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      payloadHash: String(row.payload_hash),
      preconditionSnapshot: row.precondition_json
        ? (JSON.parse(String(row.precondition_json)) as PreconditionSnapshot)
        : null,
      diffPreview: row.diff_preview ? String(row.diff_preview) : null,
      idempotencyKey: String(row.idempotency_key),
      taintedByExternalInput: Number(row.tainted_by_external_input ?? 0) === 1,
      status: String(row.status) as ApprovalStatus,
      decisionNote: row.decision_note ? String(row.decision_note) : null,
      executionResult: row.execution_result_json
        ? (JSON.parse(String(row.execution_result_json)) as Record<string, unknown>)
        : null,
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      decidedAt: row.decided_at ? String(row.decided_at) : null,
    };
  }
}
