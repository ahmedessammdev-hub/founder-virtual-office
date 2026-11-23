import path from "node:path";
import type { LoadedEmployee, RiskTier } from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import { PathAccessError, assertReadableProjectFile } from "../company/path-guard.js";

const TIER_RANK: Record<RiskTier, number> = {
  tier1_auto: 1,
  tier2_guarded: 2,
  tier3_approval: 3,
};

export type PolicyDecision =
  | { outcome: "allow"; reason: string }
  | { outcome: "require_approval"; reason: string; requiredTier: RiskTier }
  | { outcome: "deny"; reason: string };

export const DEFAULT_TOOL_RISK_TIERS: Record<string, RiskTier> = {
  read_file: "tier1_auto",
  search: "tier1_auto",
  analyze: "tier1_auto",
  git_diff: "tier1_auto",
  plan_tasks: "tier1_auto",
  draft_role_proposal: "tier1_auto",
  draft_skill_patch: "tier1_auto",
  evaluate_feedback: "tier1_auto",
  draft_prd: "tier1_auto",
  competitive_research: "tier1_auto",
  draft_campaign: "tier1_auto",
  draft_copy: "tier1_auto",
  analyze_funnel: "tier1_auto",
  browser_fetch: "tier1_auto",
  github_list_issues: "tier1_auto",
  office_search_memory: "tier1_auto",
  office_save_working_note: "tier1_auto",
  office_list_tasks: "tier1_auto",
  office_create_task: "tier1_auto",
  office_write_deliverable: "tier1_auto",
  write_file_worktree: "tier2_guarded",
  run_tests: "tier2_guarded",
  write_project_code: "tier2_guarded",
  github_create_issue: "tier3_approval",
  office_request_approval: "tier3_approval",
  git_merge: "tier3_approval",
  git_push: "tier3_approval",
  send_email: "tier3_approval",
  publish_content: "tier3_approval",
  delete_file: "tier3_approval",
  delete_project: "tier3_approval",
  modify_permissions: "tier3_approval",
  promote_memory: "tier3_approval",
  hire_employee: "tier3_approval",
  unlock_sensitive_file: "tier3_approval",
};

/**
 * Deterministic 3-Tier Policy Guard.
 * Always reads LIVE permissions from `CompanyStore` so revoking a permission takes effect
 * immediately on the very next tool evaluation even while a run is active.
 */
export class PolicyGuard {
  constructor(private readonly companyStore: CompanyStore) {}

  public evaluate(input: {
    employeeId: string;
    toolName: string;
    requestedRiskTier?: RiskTier;
    projectId?: string | null;
    targetPath?: string;
    unlockedSensitivePaths?: Set<string>;
    mcpServerId?: string;
  }): PolicyDecision {
    const employee = this.companyStore.getEmployee(input.employeeId);
    if (!employee) {
      return { outcome: "deny", reason: `Unknown employee "${input.employeeId}".` };
    }

    const perms = employee.permissions;

    // Project assignment & employee project ACL check
    if (input.projectId) {
      const project = this.companyStore.getProject(input.projectId);
      if (!project) {
        return { outcome: "deny", reason: `Unknown project "${input.projectId}".` };
      }
      if (
        perms.allowedProjectIds !== "*" &&
        !perms.allowedProjectIds.includes(input.projectId)
      ) {
        return {
          outcome: "deny",
          reason: `Employee "${input.employeeId}" is not permitted on project "${input.projectId}".`,
        };
      }
      if (
        project.assignedEmployeeIds !== "*" &&
        !project.assignedEmployeeIds.includes(input.employeeId)
      ) {
        return {
          outcome: "deny",
          reason: `Project "${input.projectId}" does not assign employee "${input.employeeId}".`,
        };
      }
    }

    // Explicit tool deny check (evaluated before allowlist)
    if (
      perms.deniedTools.includes(input.toolName) ||
      (input.mcpServerId &&
        (perms.deniedTools.includes(`mcp:${input.mcpServerId}:${input.toolName}`) ||
          perms.deniedTools.includes(`mcp:${input.mcpServerId}:*`)))
    ) {
      return {
        outcome: "deny",
        reason: `Tool "${input.toolName}" is explicitly denied for "${input.employeeId}".`,
      };
    }

    // Canonical path & sensitive file guard if a target path is provided
    if (input.targetPath) {
      const allowedRoots = this.resolveAllowedRoots(employee, input.projectId);
      try {
        assertReadableProjectFile(
          input.targetPath,
          allowedRoots,
          input.unlockedSensitivePaths,
        );
      } catch (err) {
        if (err instanceof PathAccessError && err.code === "SENSITIVE_FILE_BLOCKED") {
          return {
            outcome: "require_approval",
            requiredTier: "tier3_approval",
            reason: err.message,
          };
        }
        return {
          outcome: "deny",
          reason: err instanceof Error ? err.message : "Path access denied.",
        };
      }
    }

    const effectiveTier =
      input.requestedRiskTier ?? DEFAULT_TOOL_RISK_TIERS[input.toolName] ?? "tier3_approval";

    if (effectiveTier === "tier3_approval") {
      return {
        outcome: "require_approval",
        requiredTier: "tier3_approval",
        reason: `Action "${input.toolName}" is Tier 3 and requires founder approval.`,
      };
    }

    // Internal Virtual Office coordination tools are permitted for all employees unless explicitly denied
    const isInternalOfficeTool =
      input.toolName.startsWith("office_") && input.toolName !== "office_request_approval";

    const mcpAllowed =
      Boolean(input.mcpServerId) &&
      (perms.allowedTools.includes("mcp:*") ||
        perms.allowedTools.includes(`mcp:${input.mcpServerId}:*`) ||
        perms.allowedTools.includes(`mcp:${input.mcpServerId}:${input.toolName}`));

    // Tool must be allowed (or wildcard '*' or explicit MCP grant)
    if (
      !isInternalOfficeTool &&
      !mcpAllowed &&
      !perms.allowedTools.includes("*") &&
      !perms.allowedTools.includes(input.toolName)
    ) {
      return {
        outcome: "deny",
        reason: `Tool "${input.toolName}" is not in allowedTools for "${input.employeeId}".`,
      };
    }

    if (TIER_RANK[effectiveTier] > TIER_RANK[perms.maxRiskTier]) {
      return {
        outcome: "require_approval",
        requiredTier: "tier3_approval",
        reason: `Action "${input.toolName}" (${effectiveTier}) exceeds maxRiskTier (${perms.maxRiskTier}) for "${input.employeeId}".`,
      };
    }

    if (effectiveTier === "tier2_guarded") {
      if (input.projectId) {
        const project = this.companyStore.getProject(input.projectId);
        if (project?.isGitRepo && !perms.tier2AutoInWorktree) {
          return {
            outcome: "require_approval",
            requiredTier: "tier3_approval",
            reason: `Employee "${input.employeeId}" requires approval for workspace edits.`,
          };
        }
      }
    }

    return { outcome: "allow", reason: `Permitted under ${effectiveTier}.` };
  }

  private resolveAllowedRoots(employee: LoadedEmployee, projectId?: string | null): string[] {
    const roots: string[] = [
      employee.rootDir,
      path.join(this.companyStore.companyRoot, "memory"),
      path.join(this.companyStore.companyRoot, "deliverables"),
    ];
    if (projectId) {
      const project = this.companyStore.getProject(projectId);
      if (project) {
        roots.push(project.rootPath);
      }
    }
    return roots;
  }
}
