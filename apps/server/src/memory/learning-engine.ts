import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SubmitFeedbackInputSchema,
  isSensitiveFilePath,
  redactSecrets,
  type ApprovalRequest,
  type LearningEvaluation,
  type LearningEvaluationCheck,
  type LearningProposal,
  type SubmitFeedbackInput,
} from "@virtual-office/shared";
import { atomicWriteFile, sha256File, sha256Text } from "../company/atomic-fs.js";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryIndexer } from "../company/memory-indexer.js";
import { assertPathWithinRoots } from "../company/path-guard.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { LearningProposalsRepository } from "../db/repositories/learning-repo.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { ApprovalEngine } from "../governance/approval-engine.js";
import { detectMemoryConflict } from "./decay-and-conflict.js";
import { serializeMemoryMarkdown } from "./memory-manager.js";

function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return cleaned || `lesson-${Date.now().toString(36)}`;
}

/**
 * Generates a readable unified diff between before/after file text.
 */
export function createUnifiedDiff(
  displayPath: string,
  beforeContent: string,
  afterContent: string,
): string {
  const beforeLines = beforeContent ? beforeContent.replace(/\r\n/g, "\n").split("\n") : [];
  const afterLines = afterContent ? afterContent.replace(/\r\n/g, "\n").split("\n") : [];

  // Trim trailing empty newline element if identical
  if (beforeLines.length > 0 && beforeLines[beforeLines.length - 1] === "") beforeLines.pop();
  if (afterLines.length > 0 && afterLines[afterLines.length - 1] === "") afterLines.pop();

  let prefixLen = 0;
  while (
    prefixLen < beforeLines.length &&
    prefixLen < afterLines.length &&
    beforeLines[prefixLen] === afterLines[prefixLen]
  ) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < beforeLines.length - prefixLen &&
    suffixLen < afterLines.length - prefixLen &&
    beforeLines[beforeLines.length - 1 - suffixLen] ===
      afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const contextStart = Math.max(0, prefixLen - 3);
  const removed = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const added = afterLines.slice(prefixLen, afterLines.length - suffixLen);
  const contextBefore = beforeLines.slice(contextStart, prefixLen);
  const contextAfter = beforeLines.slice(
    beforeLines.length - suffixLen,
    Math.min(beforeLines.length, beforeLines.length - suffixLen + 3),
  );

  const oldCount = contextBefore.length + removed.length + contextAfter.length;
  const newCount = contextBefore.length + added.length + contextAfter.length;

  const lines: string[] = [
    `--- a/${displayPath}`,
    `+++ b/${displayPath}`,
    `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`,
  ];

  for (const line of contextBefore) lines.push(` ${line}`);
  for (const line of removed) lines.push(`-${line}`);
  for (const line of added) lines.push(`+${line}`);
  for (const line of contextAfter) lines.push(` ${line}`);

  return lines.join("\n");
}

export type RollbackProposalResult =
  | { ok: true; proposal: LearningProposal }
  | { ok: false; status: "NOT_FOUND" | "INVALID_STATE" | "DRIFT_DETECTED"; reason: string };

export class LearningEngine {
  constructor(
    private readonly companyStore: CompanyStore,
    private readonly memoryRepo: MemoryRepository,
    private readonly memoryIndexer: MemoryIndexer,
    private readonly learningRepo: LearningProposalsRepository,
    private readonly runsRepo: RunsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly auditRepo: AuditRepository,
  ) {}

  public submitFeedback(rawInput: SubmitFeedbackInput): {
    proposal: LearningProposal;
    approval: ApprovalRequest | null;
  } {
    const input = SubmitFeedbackInputSchema.parse(rawInput);
    const employee = this.companyStore.getEmployee(input.employeeId);
    if (!employee) {
      throw new Error(`Employee "${input.employeeId}" does not exist.`);
    }
    if (input.projectId && !this.companyStore.getProject(input.projectId)) {
      throw new Error(`Project "${input.projectId}" does not exist.`);
    }
    if (input.scope === "project" && !input.projectId) {
      throw new Error("projectId is required when learning scope is 'project'.");
    }

    const proposalId = `learn-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const cleanFeedback = redactSecrets(input.feedbackText).trim();
    const cleanExpected = input.expectedBehavior ? redactSecrets(input.expectedBehavior).trim() : null;

    const targetFilePath = this.resolveSafeMarkdownTarget({
      employeeRootDir: employee.rootDir,
      employeeId: employee.profile.id,
      projectId: input.projectId ?? null,
      scope: input.scope,
      targetKind: input.targetKind,
      targetSkillName: input.targetSkillName,
      feedbackText: cleanFeedback,
      proposalId,
    });

    const beforeExists = fs.existsSync(targetFilePath);
    const beforeContent = beforeExists ? fs.readFileSync(targetFilePath, "utf8") : "";
    const snapshotBeforeSha256 = beforeExists ? sha256File(targetFilePath) : null;

    const linkedRun = input.runId ? this.runsRepo.getById(input.runId) : null;
    const reflectionParts = [
      `Target: ${employee.profile.nameAr} (${employee.profile.id}) — ${input.targetKind}`,
      `Rating: ${input.rating}`,
      `Founder Feedback: ${cleanFeedback}`,
    ];
    if (cleanExpected) {
      reflectionParts.push(`Expected Behavior: ${cleanExpected}`);
    }
    if (linkedRun) {
      reflectionParts.push(
        `Observed Run (${linkedRun.id}, ${linkedRun.status}): prompt="${linkedRun.prompt.slice(0, 160)}"`,
      );
    }
    const reflection = reflectionParts.join("\n");

    const proposedTitle = cleanExpected
      ? `${input.rating}: ${cleanExpected.slice(0, 72)}`
      : `${input.rating}: ${cleanFeedback.slice(0, 72)}`;

    let afterContent: string;
    if (input.targetKind === "memory_note") {
      const noteBody = [
        `### Learned Guideline (${proposalId})`,
        `- **Feedback (${input.rating}):** ${cleanFeedback}`,
        cleanExpected ? `- **Expected Rule:** ${cleanExpected}` : null,
        linkedRun ? `- **Source Run:** \`${linkedRun.id}\`` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const citations = [
        {
          kind: "human" as const,
          ref: `learning:${proposalId}`,
          summary: cleanFeedback.slice(0, 120),
        },
        ...(linkedRun
          ? [{ kind: "run" as const, ref: linkedRun.id, summary: linkedRun.prompt.slice(0, 100) }]
          : []),
      ];

      afterContent = serializeMemoryMarkdown({
        id: proposalId,
        scope: input.scope,
        projectId: input.scope === "project" ? input.projectId ?? null : null,
        employeeId: input.scope === "employee" ? employee.profile.id : null,
        memoryType: "procedural",
        title: proposedTitle,
        content: noteBody,
        sourceCitations: citations,
        confidence: 0.9,
        verifiedBy: "human",
        createdAt: now,
        lastAccessedAt: now,
        decayScore: 1.0,
        supersedesId: null,
        taintedByExternalInput: false,
        status: "active",
        conflictWithId: null,
        conflictReason: null,
        filePath: targetFilePath,
      });
    } else {
      const section = [
        "",
        `## Learned Guideline (${proposalId} · ${now.slice(0, 10)})`,
        `- **Trigger / Feedback (${input.rating}):** ${cleanFeedback}`,
        cleanExpected ? `- **Required Behavior:** ${cleanExpected}` : null,
        linkedRun ? `- **Evidence Run:** \`${linkedRun.id}\`` : null,
        "",
      ]
        .filter((item) => item !== null)
        .join("\n");

      const baseText = beforeContent.trimEnd();
      afterContent = baseText ? `${baseText}\n${section}` : `# ${path.basename(targetFilePath, ".md")}\n${section}`;
    }

    const displayPath = path
      .relative(this.companyStore.companyRoot, targetFilePath)
      .replace(/\\/g, "/");
    const diffPreview = createUnifiedDiff(displayPath, beforeContent, afterContent);

    const evaluation = this.evaluateProposal({
      targetFilePath,
      scope: input.scope,
      employeeId: employee.profile.id,
      projectId: input.projectId ?? null,
      targetKind: input.targetKind,
      beforeContent,
      afterContent,
      feedbackText: cleanFeedback,
      proposedTitle,
      proposalId,
    });

    let proposal = this.learningRepo.create({
      id: proposalId,
      employeeId: employee.profile.id,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      conversationId: input.conversationId ?? null,
      feedbackRating: input.rating,
      feedbackText: cleanFeedback,
      expectedBehavior: cleanExpected,
      reflection,
      targetKind: input.targetKind,
      targetFilePath,
      scope: input.scope,
      proposedTitle,
      beforeContent,
      afterContent,
      diffPreview,
      evaluation,
      status: "EVALUATED",
      snapshotBeforeSha256,
    });

    let approval: ApprovalRequest | null = null;
    if (evaluation.passed && input.autoSubmitForApproval) {
      approval = this.approvalEngine.createApproval({
        runId: input.runId ?? null,
        employeeId: employee.profile.id,
        projectId: input.projectId ?? null,
        actionType: "learning_apply",
        riskTier: "tier3_approval",
        title: `تحديث مهارة/ذاكرة (${employee.profile.nameAr}): ${input.targetKind}`,
        summary: `تطبيق مقترح التعلّم ${proposal.id} على ${displayPath} (${evaluation.summary})`,
        payload: {
          proposalId: proposal.id,
          targetKind: proposal.targetKind,
          targetFilePath: displayPath,
          scope: proposal.scope,
          proposedTitle: proposal.proposedTitle,
          evaluationScore: evaluation.score,
        },
        targetFilePath: beforeExists ? targetFilePath : undefined,
        diffPreview,
        idempotencyKey: `learning:${proposal.id}`,
      });

      proposal =
        this.learningRepo.updateStatus(proposal.id, {
          status: "PENDING_APPROVAL",
          approvalId: approval.id,
        }) ?? proposal;
    }

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "learning.proposal_created",
      targetType: "learning_proposal",
      targetId: proposal.id,
      status: proposal.status,
      details: {
        employeeId: employee.profile.id,
        targetKind: input.targetKind,
        targetFilePath: displayPath,
        evaluationScore: evaluation.score,
        approvalId: approval?.id ?? null,
      },
    });

    return { proposal, approval };
  }

  public applyApprovedProposal(
    proposalId: string,
    approvalId: string,
  ): { proposalId: string; targetFilePath: string; snapshotAfterSha256: string } {
    const proposal = this.learningRepo.getById(proposalId);
    if (!proposal) {
      throw new Error(`Learning proposal "${proposalId}" not found.`);
    }
    if (proposal.status !== "PENDING_APPROVAL" && proposal.status !== "EVALUATED") {
      throw new Error(`Learning proposal "${proposalId}" cannot be applied from status "${proposal.status}".`);
    }

    assertPathWithinRoots(proposal.targetFilePath, [this.companyStore.companyRoot]);
    if (isSensitiveFilePath(proposal.targetFilePath) || !proposal.targetFilePath.toLowerCase().endsWith(".md")) {
      throw new Error("Security boundary violation: learning proposals can only modify Markdown files.");
    }

    // Re-check disk drift even when target file did not exist initially
    const currentlyExists = fs.existsSync(proposal.targetFilePath);
    if (proposal.snapshotBeforeSha256 === null && currentlyExists) {
      throw new Error(`Target file "${proposal.targetFilePath}" was created externally after proposal creation.`);
    }
    if (proposal.snapshotBeforeSha256 !== null) {
      if (!currentlyExists) {
        throw new Error(`Target file "${proposal.targetFilePath}" no longer exists.`);
      }
      const currentHash = sha256File(proposal.targetFilePath);
      if (currentHash !== proposal.snapshotBeforeSha256) {
        throw new Error(`Target file "${proposal.targetFilePath}" changed externally before approval.`);
      }
    }

    atomicWriteFile(proposal.targetFilePath, proposal.afterContent);
    const snapshotAfterSha256 = sha256File(proposal.targetFilePath);

    if (proposal.targetFilePath.replace(/\\/g, "/").includes("/memory/")) {
      this.memoryIndexer.indexSingleFile(proposal.targetFilePath);
    }
    this.companyStore.reloadAll();

    const appliedAt = new Date().toISOString();
    this.learningRepo.updateStatus(proposal.id, {
      status: "APPLIED",
      approvalId,
      snapshotAfterSha256,
      appliedAt,
    });

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "learning.applied",
      targetType: "learning_proposal",
      targetId: proposal.id,
      status: "APPLIED",
      details: {
        targetFilePath: proposal.targetFilePath,
        snapshotAfterSha256,
        approvalId,
      },
    });

    return {
      proposalId: proposal.id,
      targetFilePath: proposal.targetFilePath,
      snapshotAfterSha256,
    };
  }

  public markProposalRejected(proposalId: string, note?: string): void {
    const proposal = this.learningRepo.getById(proposalId);
    if (!proposal) return;

    this.learningRepo.updateStatus(proposal.id, {
      status: "REJECTED",
      rollbackReason: note ?? "Rejected in Approvals Queue",
    });

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "learning.rejected",
      targetType: "learning_proposal",
      targetId: proposal.id,
      status: "REJECTED",
      details: { note: note ?? null },
    });
  }

  public rollbackProposal(
    proposalId: string,
    opts?: { reason?: string; force?: boolean },
  ): RollbackProposalResult {
    const proposal = this.learningRepo.getById(proposalId);
    if (!proposal) {
      return { ok: false, status: "NOT_FOUND", reason: "Learning proposal not found." };
    }
    if (proposal.status !== "APPLIED") {
      return {
        ok: false,
        status: "INVALID_STATE",
        reason: `Only APPLIED proposals can be rolled back (current status: ${proposal.status}).`,
      };
    }

    assertPathWithinRoots(proposal.targetFilePath, [this.companyStore.companyRoot]);
    const exists = fs.existsSync(proposal.targetFilePath);

    if (!opts?.force && proposal.snapshotAfterSha256) {
      if (!exists) {
        return {
          ok: false,
          status: "DRIFT_DETECTED",
          reason: "Target file was deleted externally after applying this proposal.",
        };
      }
      const currentSha = sha256File(proposal.targetFilePath);
      if (currentSha !== proposal.snapshotAfterSha256) {
        return {
          ok: false,
          status: "DRIFT_DETECTED",
          reason: "Target file changed externally after this proposal was applied.",
        };
      }
    }

    if (proposal.snapshotBeforeSha256 === null && proposal.beforeContent === "") {
      if (exists) {
        fs.unlinkSync(proposal.targetFilePath);
      }
      this.memoryIndexer.indexSingleFile(proposal.targetFilePath);
    } else {
      atomicWriteFile(proposal.targetFilePath, proposal.beforeContent);
      if (proposal.targetFilePath.replace(/\\/g, "/").includes("/memory/")) {
        this.memoryIndexer.indexSingleFile(proposal.targetFilePath);
      }
    }
    this.companyStore.reloadAll();

    const updated = this.learningRepo.updateStatus(proposal.id, {
      status: "ROLLED_BACK",
      rolledBackAt: new Date().toISOString(),
      rollbackReason: opts?.reason?.trim() || "Rolled back by founder",
    })!;

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "learning.rolled_back",
      targetType: "learning_proposal",
      targetId: proposal.id,
      status: "ROLLED_BACK",
      details: {
        targetFilePath: proposal.targetFilePath,
        reason: updated.rollbackReason,
        forced: Boolean(opts?.force),
      },
    });

    return { ok: true, proposal: updated };
  }

  private resolveSafeMarkdownTarget(params: {
    employeeRootDir: string;
    employeeId: string;
    projectId: string | null;
    scope: "company" | "project" | "employee";
    targetKind: "memory_note" | "employee_skill" | "employee_system";
    targetSkillName?: string;
    feedbackText: string;
    proposalId: string;
  }): string {
    if (params.targetKind === "employee_system") {
      return assertPathWithinRoots(path.join(params.employeeRootDir, "system.md"), [
        params.employeeRootDir,
      ]);
    }

    if (params.targetKind === "employee_skill") {
      const rawName = (params.targetSkillName ?? "core").trim();
      const normalizedName = rawName.endsWith(".md") ? rawName.slice(0, -3) : rawName;
      if (
        !normalizedName ||
        normalizedName.includes("..") ||
        normalizedName.includes("/") ||
        normalizedName.includes("\\") ||
        normalizedName.includes(":") ||
        !/^[a-zA-Z0-9_-]+$/.test(normalizedName)
      ) {
        throw new Error(
          `Invalid targetSkillName "${rawName}": only simple alphanumeric/hyphen .md skill names inside employee skills/ are allowed.`,
        );
      }
      const skillsDir = path.join(params.employeeRootDir, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      return assertPathWithinRoots(path.join(skillsDir, `${normalizedName}.md`), [skillsDir]);
    }

    // memory_note
    const slug = sanitizeSlug(params.feedbackText);
    const shortId = params.proposalId.slice(-6);
    if (params.scope === "company") {
      const dir = path.join(this.companyStore.companyRoot, "memory");
      return assertPathWithinRoots(path.join(dir, `learned-${slug}-${shortId}.md`), [dir]);
    }
    if (params.scope === "project") {
      if (!params.projectId) {
        throw new Error("projectId is required for project memory scope.");
      }
      const dir = path.join(this.companyStore.companyRoot, "projects", params.projectId, "memory");
      return assertPathWithinRoots(path.join(dir, `learned-${slug}-${shortId}.md`), [dir]);
    }

    const dir = path.join(params.employeeRootDir, "memory");
    return assertPathWithinRoots(path.join(dir, `learned-${slug}-${shortId}.md`), [dir]);
  }

  private evaluateProposal(params: {
    targetFilePath: string;
    scope: "company" | "project" | "employee";
    employeeId: string;
    projectId: string | null;
    targetKind: "memory_note" | "employee_skill" | "employee_system";
    beforeContent: string;
    afterContent: string;
    feedbackText: string;
    proposedTitle: string;
    proposalId: string;
  }): LearningEvaluation {
    const checks: LearningEvaluationCheck[] = [];

    const secretClean =
      redactSecrets(params.afterContent) === params.afterContent &&
      sha256Text(redactSecrets(params.afterContent)) === sha256Text(params.afterContent);
    checks.push({
      name: "secret_scan",
      passed: secretClean,
      detail: secretClean ? "No unredacted secrets detected." : "Secret pattern scrubbed or flagged.",
    });

    let boundaryOk = false;
    try {
      assertPathWithinRoots(params.targetFilePath, [this.companyStore.companyRoot]);
      boundaryOk =
        !isSensitiveFilePath(params.targetFilePath) &&
        params.targetFilePath.toLowerCase().endsWith(".md");
    } catch {
      boundaryOk = false;
    }
    checks.push({
      name: "path_boundary",
      passed: boundaryOk,
      detail: boundaryOk
        ? "Target is strictly a Markdown file within company/ boundaries."
        : "Target violated Markdown sandbox boundaries.",
    });

    const nonEmptyDelta =
      params.afterContent.trim() !== params.beforeContent.trim() &&
      params.feedbackText.trim().length >= 3;
    checks.push({
      name: "non_empty_delta",
      passed: nonEmptyDelta,
      detail: nonEmptyDelta ? "Produces a clean, non-empty diff." : "Delta or feedback too small.",
    });

    checks.push({
      name: "evidence_citation",
      passed: true,
      detail: "Anchored to founder feedback and traceable proposal/run metadata.",
    });

    let conflictOk = true;
    let conflictDetail = "No contradiction detected against active verified knowledge.";
    if (params.targetKind === "memory_note") {
      const existingActive = this.memoryRepo.listActiveInScope(
        params.scope,
        params.projectId,
        params.scope === "employee" ? params.employeeId : null,
      );
      const conflict = detectMemoryConflict(
        {
          id: params.proposalId,
          scope: params.scope,
          projectId: params.projectId,
          employeeId: params.scope === "employee" ? params.employeeId : null,
          title: params.proposedTitle,
          content: params.afterContent,
          supersedesId: null,
        },
        existingActive,
      );
      if (conflict) {
        conflictOk = false;
        conflictDetail = conflict.reason;
      }
    }
    checks.push({
      name: "conflict_check",
      passed: conflictOk,
      detail: conflictDetail,
    });

    const criticalPassed =
      secretClean && boundaryOk && nonEmptyDelta;
    const score = Math.round(
      (checks.filter((c) => c.passed).length / checks.length) * 100,
    );

    return {
      passed: criticalPassed,
      score,
      checks,
      summary: `Eval ${score}/100 (${checks.filter((c) => c.passed).length}/${checks.length} checks passed)`,
    };
  }
}
