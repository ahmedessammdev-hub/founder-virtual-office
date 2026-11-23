import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  FeedbackRating,
  LearningEvaluation,
  LearningProposal,
  LearningProposalStatus,
  LearningTargetKind,
  MemoryScope,
} from "@virtual-office/shared";

export class LearningProposalsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    employeeId: string;
    projectId?: string | null;
    runId?: string | null;
    conversationId?: string | null;
    feedbackRating: FeedbackRating;
    feedbackText: string;
    expectedBehavior?: string | null;
    reflection: string;
    targetKind: LearningTargetKind;
    targetFilePath: string;
    scope: MemoryScope;
    proposedTitle: string;
    beforeContent: string;
    afterContent: string;
    diffPreview: string;
    evaluation: LearningEvaluation;
    status: LearningProposalStatus;
    approvalId?: string | null;
    snapshotBeforeSha256?: string | null;
    snapshotAfterSha256?: string | null;
  }): LearningProposal {
    const now = new Date().toISOString();
    const record: LearningProposal = {
      id: input.id ?? `learn-${crypto.randomUUID()}`,
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      conversationId: input.conversationId ?? null,
      feedbackRating: input.feedbackRating,
      feedbackText: input.feedbackText,
      expectedBehavior: input.expectedBehavior ?? null,
      reflection: input.reflection,
      targetKind: input.targetKind,
      targetFilePath: input.targetFilePath,
      scope: input.scope,
      proposedTitle: input.proposedTitle,
      beforeContent: input.beforeContent,
      afterContent: input.afterContent,
      diffPreview: input.diffPreview,
      evaluation: input.evaluation,
      status: input.status,
      approvalId: input.approvalId ?? null,
      snapshotBeforeSha256: input.snapshotBeforeSha256 ?? null,
      snapshotAfterSha256: input.snapshotAfterSha256 ?? null,
      rolledBackAt: null,
      rollbackReason: null,
      createdAt: now,
      updatedAt: now,
      appliedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO learning_proposals (
          id, employee_id, project_id, run_id, conversation_id,
          feedback_rating, feedback_text, expected_behavior, reflection,
          target_kind, target_file_path, scope, proposed_title,
          before_content, after_content, diff_preview, evaluation_json,
          status, approval_id, snapshot_before_sha256, snapshot_after_sha256,
          rolled_back_at, rollback_reason, created_at, updated_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.employeeId,
        record.projectId ?? null,
        record.runId ?? null,
        record.conversationId ?? null,
        record.feedbackRating,
        record.feedbackText,
        record.expectedBehavior ?? null,
        record.reflection,
        record.targetKind,
        record.targetFilePath,
        record.scope,
        record.proposedTitle,
        record.beforeContent,
        record.afterContent,
        record.diffPreview,
        JSON.stringify(record.evaluation),
        record.status,
        record.approvalId ?? null,
        record.snapshotBeforeSha256 ?? null,
        record.snapshotAfterSha256 ?? null,
        record.rolledBackAt ?? null,
        record.rollbackReason ?? null,
        record.createdAt,
        record.updatedAt,
        record.appliedAt ?? null,
      );

    return record;
  }

  public getById(id: string): LearningProposal | null {
    const row = this.db
      .prepare("SELECT * FROM learning_proposals WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getByApprovalId(approvalId: string): LearningProposal | null {
    const row = this.db
      .prepare("SELECT * FROM learning_proposals WHERE approval_id = ?")
      .get(approvalId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public list(filter?: {
    status?: LearningProposalStatus;
    employeeId?: string;
    limit?: number;
  }): LearningProposal[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];

    if (filter?.status) {
      clauses.push("status = ?");
      args.push(filter.status);
    }
    if (filter?.employeeId) {
      clauses.push("employee_id = ?");
      args.push(filter.employeeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 300);
    const rows = this.db
      .prepare(`SELECT * FROM learning_proposals ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(
    id: string,
    patch: {
      status: LearningProposalStatus;
      approvalId?: string | null;
      snapshotAfterSha256?: string | null;
      appliedAt?: string | null;
      rolledBackAt?: string | null;
      rollbackReason?: string | null;
    },
  ): LearningProposal | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE learning_proposals SET
           status = ?,
           approval_id = ?,
           snapshot_after_sha256 = ?,
           applied_at = ?,
           rolled_back_at = ?,
           rollback_reason = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.approvalId !== undefined ? patch.approvalId : existing.approvalId ?? null,
        patch.snapshotAfterSha256 !== undefined
          ? patch.snapshotAfterSha256
          : existing.snapshotAfterSha256 ?? null,
        patch.appliedAt !== undefined ? patch.appliedAt : existing.appliedAt ?? null,
        patch.rolledBackAt !== undefined ? patch.rolledBackAt : existing.rolledBackAt ?? null,
        patch.rollbackReason !== undefined
          ? patch.rollbackReason
          : existing.rollbackReason ?? null,
        now,
        id,
      );

    return this.getById(id);
  }

  private mapRow(row: Record<string, unknown>): LearningProposal {
    return {
      id: String(row.id),
      employeeId: String(row.employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      feedbackRating: String(row.feedback_rating) as FeedbackRating,
      feedbackText: String(row.feedback_text),
      expectedBehavior: row.expected_behavior ? String(row.expected_behavior) : null,
      reflection: String(row.reflection),
      targetKind: String(row.target_kind) as LearningTargetKind,
      targetFilePath: String(row.target_file_path),
      scope: String(row.scope) as MemoryScope,
      proposedTitle: String(row.proposed_title),
      beforeContent: String(row.before_content),
      afterContent: String(row.after_content),
      diffPreview: String(row.diff_preview),
      evaluation: JSON.parse(String(row.evaluation_json)) as LearningEvaluation,
      status: String(row.status) as LearningProposalStatus,
      approvalId: row.approval_id ? String(row.approval_id) : null,
      snapshotBeforeSha256: row.snapshot_before_sha256 ? String(row.snapshot_before_sha256) : null,
      snapshotAfterSha256: row.snapshot_after_sha256 ? String(row.snapshot_after_sha256) : null,
      rolledBackAt: row.rolled_back_at ? String(row.rolled_back_at) : null,
      rollbackReason: row.rollback_reason ? String(row.rollback_reason) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      appliedAt: row.applied_at ? String(row.applied_at) : null,
    };
  }
}
