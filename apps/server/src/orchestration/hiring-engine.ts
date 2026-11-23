import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  CreateHiringProposalInputSchema,
  EmployeePermissionsSchema,
  redactSecrets,
  type ApprovalRequest,
  type CreateHiringProposalInput,
  type Department,
  type HiringProposal,
  type HiringProposalSpec,
  type HiringRoleTemplate,
} from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryIndexer } from "../company/memory-indexer.js";
import { assertPathWithinRoots } from "../company/path-guard.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { HiringProposalsRepository } from "../db/repositories/hiring-repo.js";
import type { ApprovalEngine } from "../governance/approval-engine.js";
import { serializeMemoryMarkdown } from "../memory/memory-manager.js";

const DEPARTMENT_LOOKUP: Record<string, Department> = {
  executive: { id: "executive", name: "Executive & Orchestration", nameAr: "الإدارة والتنسيق", color: "#3B49DF" },
  people: { id: "people", name: "HR & Talent", nameAr: "الموارد البشرية والتدريب", color: "#B83280" },
  engineering: { id: "engineering", name: "Engineering", nameAr: "الهندسة والبرمجة", color: "#0F8B6D" },
  product: { id: "product", name: "Product & Strategy", nameAr: "المنتجات والاستراتيجية", color: "#C27803" },
  growth: { id: "growth", name: "Growth & Content", nameAr: "التسويق والمحتوى", color: "#0E7490" },
  operations: { id: "operations", name: "Operations & Legal", nameAr: "العمليات والشؤون القانونية", color: "#6366f1" },
};

export const HIRING_ROLE_TEMPLATES: HiringRoleTemplate[] = [
  {
    id: "qa-engineer",
    label: "QA & Release Engineer",
    labelAr: "مهندس جودة واختبار",
    description: "Audits builds, writes automated Vitest/Playwright checks, and catches regressions before shipping.",
    descriptionAr: "يفحص البناء التقني، يكتب اختبارات آلية، ويمنع الأخطاء قبل التسليم.",
    defaults: {
      proposedByEmployeeId: "hr-talent",
      autoSubmitForApproval: true,
      employeeId: "qa-engineer",
      name: "Tariq",
      nameAr: "طارق",
      role: "QA & Verification Engineer",
      roleAr: "مهندس جودة واختبار",
      department: "engineering",
      avatar: "QA",
      justification: "Dedicated automated testing and release gatekeeping specialist.",
      systemPrompt:
        "You are Tariq (طارق), the QA & Verification Engineer. Audit changes carefully, run automated test suites, report exact command exit codes and defects honestly without fabricating passes.",
      coreSkillTitle: "Verification & Regression Checklist",
      coreSkillContent:
        "# Verification Checklist\n- Always verify TypeScript compilation cleanly.\n- Test happy paths, boundary conditions, and error handling.\n- Report exact observed failures and logs.",
      runtime: { provider: "agy", model: "gemini-3.8-flash-medium", effort: "medium" },
      permissions: {
        allowedTools: ["read_file", "search", "run_tests", "analyze", "git_diff"],
        deniedTools: ["git_push", "send_email", "delete_project"],
        maxRiskTier: "tier2_guarded",
        tier2AutoInWorktree: true,
        maxStepsPerRun: 30,
        taskBudgetUsd: 1.5,
        dailyBudgetUsd: 10.0,
      },
    },
  },
  {
    id: "data-analyst",
    label: "Data & BI Analyst",
    labelAr: "محلل بيانات ونمو",
    description: "Analyzes product metrics, funnel conversion, and cost/ROI telemetry in read-only safe scope.",
    descriptionAr: "يحلل مؤشرات المنتج، قمع التحويل، وكفاءة التكلفة في نطاق قراءة آمن.",
    defaults: {
      proposedByEmployeeId: "hr-talent",
      autoSubmitForApproval: true,
      employeeId: "data-analyst",
      name: "Youssef",
      nameAr: "يوسف",
      role: "Data & Metrics Analyst",
      roleAr: "محلل بيانات ونمو",
      department: "product",
      avatar: "DA",
      justification: "Provide quantitative metrics analysis and KPI reporting across projects.",
      systemPrompt:
        "You are Youssef (يوسف), Data & Metrics Analyst. Focus on measurable KPIs, cohort retention, funnel bottlenecks, and cost telemetry. Never invent figures; clearly separate verified numbers from estimates.",
      coreSkillTitle: "KPI & Funnel Analysis SOP",
      coreSkillContent:
        "# Analytics SOP\n- Define baseline metrics before recommending changes.\n- Highlight statistical caveats or missing tracking.",
      runtime: { provider: "agy", model: "gemini-3.8-flash-medium", effort: "medium" },
      permissions: {
        allowedTools: ["read_file", "search", "analyze", "analyze_funnel"],
        deniedTools: ["git_push", "send_email", "write_file_worktree"],
        maxRiskTier: "tier1_auto",
        tier2AutoInWorktree: false,
        maxStepsPerRun: 25,
        taskBudgetUsd: 1.2,
        dailyBudgetUsd: 8.0,
      },
    },
  },
  {
    id: "legal-advisor",
    label: "Legal & Compliance Counsel",
    labelAr: "مستشار قانوني وامتثال",
    description: "Reviews contracts, privacy terms, licensing compatibility, and compliance risks (read-only + review).",
    descriptionAr: "يراجع العقود، سياسات الخصوصية، وتراخيص البرمجيات ومخاطر الامتثال.",
    defaults: {
      proposedByEmployeeId: "hr-talent",
      autoSubmitForApproval: true,
      employeeId: "legal-advisor",
      name: "Salma",
      nameAr: "سلمى",
      role: "Legal & Compliance Advisor",
      roleAr: "مستشارة قانونية وامتثال",
      department: "operations",
      avatar: "LG",
      justification: "Draft and audit licensing, terms of service, and privacy compliance documents.",
      systemPrompt:
        "You are Salma (سلمى), Legal & Compliance Advisor. Review agreements, open-source licenses, and compliance terms conservatively, flagging ambiguity for founder approval.",
      coreSkillTitle: "Contract & License Review Checklist",
      coreSkillContent:
        "# Legal Review Checklist\n- Flag copyleft vs permissive OSS licenses.\n- Highlight liability caps, termination clauses, and jurisdiction terms.",
      runtime: { provider: "agy", model: "gemini-3.8-flash-medium", effort: "medium" },
      permissions: {
        allowedTools: ["read_file", "search", "analyze"],
        deniedTools: ["send_email", "publish_content", "git_push", "write_file_worktree"],
        maxRiskTier: "tier1_auto",
        tier2AutoInWorktree: false,
        maxStepsPerRun: 20,
        taskBudgetUsd: 1.5,
        dailyBudgetUsd: 8.0,
      },
    },
  },
  {
    id: "devops-architect",
    label: "DevOps & Infrastructure Architect",
    labelAr: "مهندس بنية تحتية وتشغيل",
    description: "Designs CI/CD pipelines, build optimizations, and deployment checklists.",
    descriptionAr: "يصمم خطوط النشر التلقائي CI/CD وتحسين الأداء وتهيئة الخوادم.",
    defaults: {
      proposedByEmployeeId: "hr-talent",
      autoSubmitForApproval: true,
      employeeId: "devops-architect",
      name: "Omar",
      nameAr: "عمر",
      role: "DevOps & Release Architect",
      roleAr: "مهندس بنية تحتية وCI/CD",
      department: "engineering",
      avatar: "DO",
      justification: "Automate build pipelines, container specs, and observability.",
      systemPrompt:
        "You are Omar (عمر), DevOps Architect. Design reproducible builds, clean CI workflows, and safe rollback runbooks without storing plaintext secrets.",
      coreSkillTitle: "CI/CD & Safe Rollout Guidelines",
      coreSkillContent:
        "# DevOps Guidelines\n- Never commit plaintext credentials.\n- Document rollback commands alongside every deployment step.",
      runtime: { provider: "agy", model: "gemini-3.8-flash-medium", effort: "medium" },
      permissions: {
        allowedTools: ["read_file", "search", "git_diff", "write_file_worktree", "run_tests"],
        deniedTools: ["git_push", "delete_project", "send_email"],
        maxRiskTier: "tier2_guarded",
        tier2AutoInWorktree: true,
        maxStepsPerRun: 30,
        taskBudgetUsd: 2.0,
        dailyBudgetUsd: 10.0,
      },
    },
  },
];

function slugifyEmployeeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export class HiringEngine {
  public readonly bus = new EventEmitter();

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly memoryIndexer: MemoryIndexer,
    private readonly hiringRepo: HiringProposalsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly auditRepo: AuditRepository,
  ) {}

  public getRoleTemplates(): HiringRoleTemplate[] {
    return HIRING_ROLE_TEMPLATES;
  }

  public createProposal(rawInput: CreateHiringProposalInput): {
    proposal: HiringProposal;
    approval: ApprovalRequest | null;
  } {
    const input = CreateHiringProposalInputSchema.parse(rawInput);

    if (!this.companyStore.getEmployee(input.proposedByEmployeeId)) {
      throw new Error(`Proposing employee "${input.proposedByEmployeeId}" does not exist.`);
    }

    const rawIdInput = input.employeeId ?? input.role;
    if (
      rawIdInput.includes("..") ||
      rawIdInput.includes("/") ||
      rawIdInput.includes("\\")
    ) {
      throw new Error("Invalid employeeId: path traversal characters are forbidden.");
    }

    const employeeId = slugifyEmployeeId(rawIdInput);
    if (!employeeId || ["company", "admin", "root", "employees"].includes(employeeId)) {
      throw new Error(`Invalid or reserved employeeId "${rawIdInput}".`);
    }

    if (this.companyStore.getEmployee(employeeId)) {
      throw new Error(`Employee "${employeeId}" already exists.`);
    }

    const pendingDup = this.hiringRepo
      .list("PENDING_APPROVAL")
      .some((p) => p.employeeId === employeeId);
    if (pendingDup) {
      throw new Error(`A pending hiring proposal already exists for "${employeeId}".`);
    }

    const employeesRoot = path.join(this.companyStore.companyRoot, "employees");
    assertPathWithinRoots(path.join(employeesRoot, employeeId, "profile.yaml"), [employeesRoot]);

    const permissions = EmployeePermissionsSchema.parse({
      allowedTools: ["read_file", "search", "analyze"],
      deniedTools: ["git_push", "send_email", "delete_project"],
      maxRiskTier: "tier1_auto",
      ...(input.permissions ?? {}),
    });

    const proposedDesk = this.companyStore.allocateFloorplanDesk(employeeId);

    const spec: HiringProposalSpec = {
      proposedByEmployeeId: input.proposedByEmployeeId,
      employeeId,
      name: input.name.trim(),
      nameAr: input.nameAr.trim(),
      role: input.role.trim(),
      roleAr: input.roleAr.trim(),
      department: slugifyEmployeeId(input.department) || "engineering",
      avatar: input.avatar.trim().toUpperCase().slice(0, 4),
      justification: redactSecrets(input.justification).trim(),
      systemPrompt: redactSecrets(input.systemPrompt).trim(),
      coreSkillTitle: input.coreSkillTitle.trim(),
      coreSkillContent: redactSecrets(input.coreSkillContent).trim(),
      runtime: input.runtime,
      permissions,
      languagePolicy:
        input.languagePolicy ?? this.companyStore.getCompanyConfig().languagePolicy,
    };

    const diffPreview = [
      `+++ b/company/employees/${employeeId}/profile.yaml`,
      `+id: ${spec.employeeId}`,
      `+name: ${spec.name} (${spec.nameAr})`,
      `+role: ${spec.role} (${spec.roleAr})`,
      `+department: ${spec.department}`,
      `+deskId: ${proposedDesk.id} @ (${proposedDesk.x}, ${proposedDesk.y})`,
      `+runtime: ${spec.runtime.provider}/${spec.runtime.model}`,
      "",
      `+++ b/company/employees/${employeeId}/permissions.json`,
      `+maxRiskTier: ${spec.permissions.maxRiskTier}`,
      `+allowedTools: ${spec.permissions.allowedTools.join(", ")}`,
      `+taskBudgetUsd: $${spec.permissions.taskBudgetUsd} | dailyBudgetUsd: $${spec.permissions.dailyBudgetUsd}`,
      "",
      `+++ b/company/company.json (floorplan.desks)`,
      `+{ "id": "${proposedDesk.id}", "zoneId": "${proposedDesk.zoneId}", "x": ${proposedDesk.x}, "y": ${proposedDesk.y}, "employeeId": "${employeeId}" }`,
    ].join("\n");

    let proposal = this.hiringRepo.create({
      proposedByEmployeeId: spec.proposedByEmployeeId,
      employeeId,
      spec,
      proposedDesk,
      diffPreview,
      status: "DRAFT",
    });

    let approval: ApprovalRequest | null = null;
    if (input.autoSubmitForApproval) {
      approval = this.approvalEngine.createApproval({
        employeeId: spec.proposedByEmployeeId,
        actionType: "hire_employee",
        riskTier: "tier3_approval",
        title: `توظيف موظف جديد: ${spec.nameAr} (${spec.roleAr})`,
        summary: `إنشاء مجلد ${employeeId}/ + تعيين مكتب ${proposedDesk.id} (${proposedDesk.x},${proposedDesk.y}) — ${spec.justification}`,
        payload: {
          hiringProposalId: proposal.id,
          employeeId,
          name: spec.name,
          nameAr: spec.nameAr,
          role: spec.role,
          department: spec.department,
          deskId: proposedDesk.id,
          maxRiskTier: spec.permissions.maxRiskTier,
        },
        diffPreview,
        idempotencyKey: `hire:${proposal.id}`,
      });

      proposal =
        this.hiringRepo.updateStatus(proposal.id, {
          status: "PENDING_APPROVAL",
          approvalId: approval.id,
        }) ?? proposal;
    }

    this.auditRepo.log({
      actorType: "employee",
      actorId: spec.proposedByEmployeeId,
      action: "hiring.proposal_created",
      targetType: "hiring_proposal",
      targetId: proposal.id,
      status: proposal.status,
      details: {
        employeeId,
        deskId: proposedDesk.id,
        approvalId: approval?.id ?? null,
      },
    });

    this.bus.emit("hiring_updated", proposal);
    return { proposal, approval };
  }

  public applyApprovedHire(
    proposalId: string,
    approvalId: string,
  ): { proposalId: string; employeeId: string; deskId: string } {
    const proposal = this.hiringRepo.getById(proposalId);
    if (!proposal) {
      throw new Error(`Hiring proposal "${proposalId}" not found.`);
    }
    if (proposal.status !== "PENDING_APPROVAL" && proposal.status !== "DRAFT") {
      throw new Error(`Hiring proposal "${proposalId}" cannot be provisioned from status "${proposal.status}".`);
    }

    const { spec } = proposal;
    if (this.companyStore.getEmployee(spec.employeeId)) {
      throw new Error(`Employee "${spec.employeeId}" already exists.`);
    }

    const employeesRoot = path.join(this.companyStore.companyRoot, "employees");
    const empDir = assertPathWithinRoots(path.join(employeesRoot, spec.employeeId), [employeesRoot]);
    fs.mkdirSync(path.join(empDir, "skills"), { recursive: true });
    fs.mkdirSync(path.join(empDir, "memory"), { recursive: true });

    const finalDesk = this.companyStore.allocateFloorplanDesk(spec.employeeId);

    const profileObj = {
      id: spec.employeeId,
      name: spec.name,
      nameAr: spec.nameAr,
      role: spec.role,
      roleAr: spec.roleAr,
      department: spec.department,
      avatar: spec.avatar,
      deskId: finalDesk.id,
      isOrchestrator: false,
      languagePolicy: spec.languagePolicy,
      runtime: spec.runtime,
    };

    const now = new Date().toISOString();
    const notesPath = path.join(empDir, "memory", "notes.md");
    const onboardingNote = serializeMemoryMarkdown({
      id: `${spec.employeeId}-charter`,
      scope: "employee",
      employeeId: spec.employeeId,
      projectId: null,
      memoryType: "procedural",
      title: `${spec.name} (${spec.nameAr}) — ${spec.role} Onboarding Charter`,
      content: `${spec.justification}\n\nRole Scope: ${spec.role} (${spec.roleAr}) — Desk ${finalDesk.id}`,
      sourceCitations: [
        { kind: "human", ref: `hire:${proposal.id}`, summary: "Approved founder hire" },
      ],
      confidence: 0.95,
      verifiedBy: "human",
      createdAt: now,
      lastAccessedAt: now,
      decayScore: 1.0,
      supersedesId: null,
      taintedByExternalInput: false,
      status: "active",
      conflictWithId: null,
      conflictReason: null,
      filePath: notesPath,
    });

    atomicWriteFile(path.join(empDir, "profile.yaml"), stringifyYaml(profileObj));
    atomicWriteFile(
      path.join(empDir, "system.md"),
      `# ${spec.name} (${spec.nameAr}) — ${spec.role}\n\n${spec.systemPrompt}\n`,
    );
    atomicWriteFile(
      path.join(empDir, "permissions.json"),
      JSON.stringify(spec.permissions, null, 2),
    );
    atomicWriteFile(
      path.join(empDir, "skills", "core.md"),
      `# ${spec.coreSkillTitle}\n\n${spec.coreSkillContent}\n`,
    );
    atomicWriteFile(notesPath, onboardingNote);

    const deptMeta = DEPARTMENT_LOOKUP[spec.department] ?? {
      id: spec.department,
      name: spec.department,
      nameAr: spec.department,
      color: "#3B49DF",
    };
    this.companyStore.addEmployeeDesk(finalDesk, deptMeta);
    this.companyStore.reloadAll();

    const updated = this.hiringRepo.updateStatus(proposal.id, {
      status: "PROVISIONED",
      approvalId,
      provisionedAt: now,
    });

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "hiring.provisioned",
      targetType: "employee",
      targetId: spec.employeeId,
      status: "PROVISIONED",
      details: { proposalId: proposal.id, deskId: finalDesk.id, approvalId },
    });

    if (updated) this.bus.emit("hiring_updated", updated);
    return {
      proposalId: proposal.id,
      employeeId: spec.employeeId,
      deskId: finalDesk.id,
    };
  }

  public markProposalRejected(proposalId: string, note?: string): void {
    const proposal = this.hiringRepo.getById(proposalId);
    if (!proposal) return;
    const updated = this.hiringRepo.updateStatus(proposal.id, {
      status: "REJECTED",
      rollbackReason: note ?? "Rejected in Approvals Queue",
    });
    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "hiring.rejected",
      targetType: "hiring_proposal",
      targetId: proposal.id,
      status: "REJECTED",
      details: { employeeId: proposal.employeeId, note: note ?? null },
    });
    if (updated) this.bus.emit("hiring_updated", updated);
  }

  public rollbackHire(proposalId: string, reason?: string): HiringProposal {
    const proposal = this.hiringRepo.getById(proposalId);
    if (!proposal) {
      throw new Error(`Hiring proposal "${proposalId}" not found.`);
    }
    if (proposal.status !== "PROVISIONED") {
      throw new Error(`Only PROVISIONED hiring proposals can be rolled back (status: ${proposal.status}).`);
    }

    const employeesRoot = path.join(this.companyStore.companyRoot, "employees");
    const empDir = assertPathWithinRoots(path.join(employeesRoot, proposal.employeeId), [
      employeesRoot,
    ]);
    if (fs.existsSync(empDir)) {
      fs.rmSync(empDir, { recursive: true, force: true });
    }

    this.companyStore.removeEmployeeDesk(proposal.employeeId);
    this.companyStore.reloadAll();
    this.memoryIndexer.syncAll();

    const updated = this.hiringRepo.updateStatus(proposal.id, {
      status: "ROLLED_BACK",
      rolledBackAt: new Date().toISOString(),
      rollbackReason: reason?.trim() || "Rolled back by founder",
    })!;

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "hiring.rolled_back",
      targetType: "employee",
      targetId: proposal.employeeId,
      status: "ROLLED_BACK",
      details: { proposalId: proposal.id, reason: updated.rollbackReason },
    });

    this.bus.emit("hiring_updated", updated);
    return updated;
  }
}
