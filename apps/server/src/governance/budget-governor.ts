import type { RunMode, RuntimeProvider } from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { UsageRepository } from "../db/repositories/usage-repo.js";

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Two-phase budget governor:
 * - Pre-flight check before launching a live run
 * - Mid-flight check on every streaming usage event
 * Mock and dry-run modes bypass budget limits and never consume live daily caps.
 */
export class BudgetGovernor {
  constructor(
    private readonly companyStore: CompanyStore,
    private readonly usageRepo: UsageRepository,
  ) {}

  public preFlightCheck(input: {
    mode: RunMode;
    employeeId: string;
    projectId?: string | null;
    provider: RuntimeProvider;
  }): BudgetCheckResult {
    if (input.mode !== "live") {
      return { allowed: true };
    }

    const company = this.companyStore.getCompanyConfig();
    const employee = this.companyStore.getEmployee(input.employeeId);
    const employeeDailyCap =
      employee?.permissions.dailyBudgetUsd ?? company.budgets.defaultDailyBudgetUsd;

    const empSpend = this.usageRepo.getLiveDailySpend({ employeeId: input.employeeId });
    if (empSpend >= employeeDailyCap) {
      return {
        allowed: false,
        reason: `Daily budget reached for employee "${input.employeeId}" ($${empSpend.toFixed(4)} / $${employeeDailyCap.toFixed(2)}).`,
      };
    }

    if (input.projectId) {
      const project = this.companyStore.getProject(input.projectId);
      const projCap = project?.dailyBudgetUsd ?? company.budgets.defaultDailyBudgetUsd;
      const projSpend = this.usageRepo.getLiveDailySpend({ projectId: input.projectId });
      if (projSpend >= projCap) {
        return {
          allowed: false,
          reason: `Daily budget reached for project "${input.projectId}" ($${projSpend.toFixed(4)} / $${projCap.toFixed(2)}).`,
        };
      }
    }

    const providerCap = company.budgets.providerDailyCapsUsd[input.provider];
    if (providerCap !== undefined) {
      const provSpend = this.usageRepo.getLiveDailySpend({ provider: input.provider });
      if (provSpend >= providerCap) {
        return {
          allowed: false,
          reason: `Daily budget reached for provider "${input.provider}" ($${provSpend.toFixed(4)} / $${providerCap.toFixed(2)}).`,
        };
      }
    }

    return { allowed: true };
  }

  public checkMidFlight(input: {
    mode: RunMode;
    runCostUsd: number;
    taskBudgetUsd: number;
    employeeId: string;
    projectId?: string | null;
    provider: RuntimeProvider;
  }): BudgetCheckResult {
    // Allow mid-flight enforcement on `mock` when taskBudgetUsd is exceeded so tests can verify it deterministically,
    // while `dry_run` never aborts for budget.
    if (input.mode === "dry_run") {
      return { allowed: true };
    }

    if (input.runCostUsd > input.taskBudgetUsd) {
      return {
        allowed: false,
        reason: `Run cost ($${input.runCostUsd.toFixed(4)}) exceeded per-task budget ($${input.taskBudgetUsd.toFixed(2)}).`,
      };
    }

    if (input.mode === "live") {
      return this.preFlightCheck({
        mode: input.mode,
        employeeId: input.employeeId,
        projectId: input.projectId,
        provider: input.provider,
      });
    }

    return { allowed: true };
  }
}
