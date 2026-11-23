import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import type {
  ApprovalDecisionInput,
  ApprovalRequest,
  PreconditionSnapshot,
  RiskTier,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import { sha256File } from "../company/atomic-fs.js";
import type { ApprovalsRepository } from "../db/repositories/approvals-repo.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export type ApprovalActionExecutor = (
  approval: ApprovalRequest,
) => Promise<Record<string, unknown>>;

export type ApprovalDecideResult =
  | { status: "EXECUTED" | "REJECTED"; approval: ApprovalRequest }
  | { status: "NOT_FOUND" }
  | { status: "EXPIRED"; approval: ApprovalRequest }
  | { status: "ALREADY_DECIDED"; approval: ApprovalRequest }
  | { status: "PRECONDITION_DRIFT"; reason: string; approval: ApprovalRequest }
  | { status: "EXECUTION_FAILED"; reason: string; approval: ApprovalRequest };

export class ApprovalEngine {
  public readonly bus = new EventEmitter();
  private readonly defaultTtlMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly approvalsRepo: ApprovalsRepository,
    private readonly auditRepo: AuditRepository,
    private readonly companyStore: CompanyStore,
  ) {}

  public capturePreconditions(
    projectId?: string | null,
    targetFilePath?: string,
  ): PreconditionSnapshot | null {
    const snapshot: PreconditionSnapshot = {};
    let hasAny = false;

    if (projectId) {
      const project = this.companyStore.getProject(projectId);
      if (project) {
        snapshot.projectId = projectId;
        hasAny = true;
        if (project.isGitRepo) {
          try {
            snapshot.gitHeadSha = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: project.rootPath,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
          } catch {
            // Unborn repo without HEAD
          }
        }
      }
    }

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      snapshot.targetFilePath = targetFilePath;
      snapshot.targetFileSha256 = sha256File(targetFilePath);
      hasAny = true;
    }

    return hasAny ? snapshot : null;
  }

  public createApproval(input: {
    runId?: string | null;
    taskId?: string | null;
    employeeId: string;
    projectId?: string | null;
    actionType: string;
    riskTier?: RiskTier;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    targetFilePath?: string;
    diffPreview?: string | null;
    idempotencyKey?: string;
    taintedByExternalInput?: boolean;
    ttlMs?: number;
  }): ApprovalRequest {
    const payloadHash = crypto
      .createHash("sha256")
      .update(canonicalJson(input.payload), "utf8")
      .digest("hex");

    const preconditionSnapshot = this.capturePreconditions(input.projectId, input.targetFilePath);
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? this.defaultTtlMs)).toISOString();
    const idempotencyKey =
      input.idempotencyKey ?? `${input.runId ?? "manual"}:${input.actionType}:${payloadHash.slice(0, 16)}`;

    const approval = this.approvalsRepo.create({
      runId: input.runId,
      taskId: input.taskId,
      employeeId: input.employeeId,
      projectId: input.projectId,
      actionType: input.actionType,
      riskTier: input.riskTier ?? "tier3_approval",
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      payloadHash,
      preconditionSnapshot,
      diffPreview: input.diffPreview,
      idempotencyKey,
      taintedByExternalInput: input.taintedByExternalInput ?? false,
      expiresAt,
    });

    this.auditRepo.log({
      actorType: "employee",
      actorId: input.employeeId,
      action: "approval.requested",
      targetType: "approval",
      targetId: approval.id,
      status: "PENDING",
      details: {
        actionType: approval.actionType,
        taintedByExternalInput: approval.taintedByExternalInput,
        payloadHash: approval.payloadHash,
      },
    });

    this.bus.emit("approval_created", approval);
    return approval;
  }

  public verifyPreconditions(approval: ApprovalRequest): { ok: true } | { ok: false; reason: string } {
    const snap = approval.preconditionSnapshot;
    if (!snap) {
      return { ok: true };
    }

    if (snap.projectId && snap.gitHeadSha) {
      const project = this.companyStore.getProject(snap.projectId);
      if (!project) {
        return { ok: false, reason: `Project "${snap.projectId}" no longer exists.` };
      }
      try {
        const currentSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: project.rootPath,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (currentSha !== snap.gitHeadSha) {
          return {
            ok: false,
            reason: `Git HEAD changed since approval request (${snap.gitHeadSha.slice(0, 7)} -> ${currentSha.slice(0, 7)}). Re-verification required.`,
          };
        }
      } catch {
        return { ok: false, reason: "Failed to verify current Git HEAD." };
      }
    }

    if (snap.targetFilePath && snap.targetFileSha256) {
      if (!fs.existsSync(snap.targetFilePath)) {
        return { ok: false, reason: `Target file "${snap.targetFilePath}" no longer exists.` };
      }
      const currentFileHash = sha256File(snap.targetFilePath);
      if (currentFileHash !== snap.targetFileSha256) {
        return {
          ok: false,
          reason: `Target file "${snap.targetFilePath}" changed since approval request.`,
        };
      }
    }

    return { ok: true };
  }

  /**
   * Decides an approval idempotently: enforces TTL expiry, precondition drift checks,
   * atomic `PENDING -> APPROVED|REJECTED` transition (blocking double-execution races),
   * and optional action execution.
   */
  public async decide(
    id: string,
    input: ApprovalDecisionInput,
    executor?: ApprovalActionExecutor,
  ): Promise<ApprovalDecideResult> {
    const existing = this.approvalsRepo.getById(id);
    if (!existing) {
      return { status: "NOT_FOUND" };
    }

    if (existing.status !== "PENDING") {
      return { status: "ALREADY_DECIDED", approval: existing };
    }

    if (Date.now() > Date.parse(existing.expiresAt)) {
      const expired = this.approvalsRepo.decidePendingApproval(id, "EXPIRED", "Approval TTL expired");
      this.auditRepo.log({
        actorType: "system",
        actorId: "approval-engine",
        action: "approval.expired",
        targetType: "approval",
        targetId: id,
        status: "EXPIRED",
      });
      return { status: "EXPIRED", approval: expired.approval ?? existing };
    }

    if (input.decision === "APPROVED") {
      const check = this.verifyPreconditions(existing);
      if (!check.ok) {
        this.auditRepo.log({
          actorType: "system",
          actorId: "approval-engine",
          action: "approval.precondition_drift",
          targetType: "approval",
          targetId: id,
          status: "BLOCKED",
          details: { reason: check.reason },
        });
        return { status: "PRECONDITION_DRIFT", reason: check.reason, approval: existing };
      }
    }

    const transition = this.approvalsRepo.decidePendingApproval(id, input.decision, input.note);
    if (!transition.updated || !transition.approval) {
      // Lost race against another concurrent decide call
      const latest = this.approvalsRepo.getById(id) ?? existing;
      return { status: "ALREADY_DECIDED", approval: latest };
    }

    if (input.decision === "REJECTED") {
      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "approval.rejected",
        targetType: "approval",
        targetId: id,
        status: "REJECTED",
        details: { note: input.note ?? null },
      });
      return { status: "REJECTED", approval: transition.approval };
    }

    try {
      const execResult = executor
        ? await executor(transition.approval)
        : { acknowledged: true, actionType: transition.approval.actionType };

      this.approvalsRepo.markExecuted(id, "EXECUTED", execResult);
      const updated = this.approvalsRepo.getById(id) ?? transition.approval;

      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "approval.executed",
        targetType: "approval",
        targetId: id,
        status: "EXECUTED",
        details: { note: input.note ?? null, execResult },
      });

      return { status: "EXECUTED", approval: updated };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Approval action execution failed.";
      this.approvalsRepo.markExecuted(id, "FAILED", { error: reason });
      const updated = this.approvalsRepo.getById(id) ?? transition.approval;

      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "approval.failed",
        targetType: "approval",
        targetId: id,
        status: "FAILED",
        details: { reason },
      });

      return { status: "EXECUTION_FAILED", reason, approval: updated };
    }
  }
}
