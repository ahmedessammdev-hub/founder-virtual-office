import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  FloorplanDesk,
  HiringProposal,
  HiringProposalSpec,
  HiringProposalStatus,
} from "@virtual-office/shared";

export class HiringProposalsRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    proposedByEmployeeId: string;
    employeeId: string;
    spec: HiringProposalSpec;
    proposedDesk: FloorplanDesk;
    diffPreview: string;
    status: HiringProposalStatus;
    approvalId?: string | null;
  }): HiringProposal {
    const now = new Date().toISOString();
    const id = input.id ?? `hire-${crypto.randomUUID().slice(0, 12)}`;
    this.db
      .prepare(
        `INSERT INTO hiring_proposals (
          id, proposed_by_employee_id, employee_id, spec_json, proposed_desk_json,
          diff_preview, status, approval_id, created_at, updated_at,
          provisioned_at, rolled_back_at, rollback_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.proposedByEmployeeId,
        input.employeeId,
        JSON.stringify(input.spec),
        JSON.stringify(input.proposedDesk),
        input.diffPreview,
        input.status,
        input.approvalId ?? null,
        now,
        now,
        null,
        null,
        null,
      );
    return this.getById(id)!;
  }

  public getById(id: string): HiringProposal | null {
    const row = this.db
      .prepare("SELECT * FROM hiring_proposals WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getByApprovalId(approvalId: string): HiringProposal | null {
    const row = this.db
      .prepare("SELECT * FROM hiring_proposals WHERE approval_id = ?")
      .get(approvalId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public list(status?: HiringProposalStatus): HiringProposal[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM hiring_proposals WHERE status = ? ORDER BY created_at DESC, rowid DESC")
          .all(status) as Array<Record<string, unknown>>)
      : (this.db
          .prepare("SELECT * FROM hiring_proposals ORDER BY created_at DESC, rowid DESC")
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(
    id: string,
    patch: {
      status: HiringProposalStatus;
      approvalId?: string | null;
      provisionedAt?: string | null;
      rolledBackAt?: string | null;
      rollbackReason?: string | null;
    },
  ): HiringProposal | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE hiring_proposals SET
           status = ?,
           approval_id = ?,
           provisioned_at = ?,
           rolled_back_at = ?,
           rollback_reason = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.approvalId !== undefined ? patch.approvalId : existing.approvalId ?? null,
        patch.provisionedAt !== undefined
          ? patch.provisionedAt
          : existing.provisionedAt ?? null,
        patch.rolledBackAt !== undefined
          ? patch.rolledBackAt
          : existing.rolledBackAt ?? null,
        patch.rollbackReason !== undefined
          ? patch.rollbackReason
          : existing.rollbackReason ?? null,
        now,
        id,
      );
    return this.getById(id);
  }

  private mapRow(row: Record<string, unknown>): HiringProposal {
    return {
      id: String(row.id),
      proposedByEmployeeId: String(row.proposed_by_employee_id),
      employeeId: String(row.employee_id),
      spec: JSON.parse(String(row.spec_json)) as HiringProposalSpec,
      proposedDesk: JSON.parse(String(row.proposed_desk_json)) as FloorplanDesk,
      diffPreview: String(row.diff_preview),
      status: String(row.status) as HiringProposalStatus,
      approvalId: row.approval_id ? String(row.approval_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      provisionedAt: row.provisioned_at ? String(row.provisioned_at) : null,
      rolledBackAt: row.rolled_back_at ? String(row.rolled_back_at) : null,
      rollbackReason: row.rollback_reason ? String(row.rollback_reason) : null,
    };
  }
}
