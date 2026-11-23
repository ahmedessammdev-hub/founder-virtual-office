import type { DatabaseSync } from "node:sqlite";
import type { AnalyticsSummary } from "@virtual-office/shared";

interface RunAggregateRow {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  waitingApprovalRuns: number;
  cancelledRuns: number;
  avgDurationMs: number | null;
}

interface UsageTotalsRow {
  liveTotalUsd: number;
  liveTodayUsd: number;
  mockTotalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Computes windowed operational performance, live-vs-mock cost attribution, and security telemetry.
 */
export class AnalyticsService {
  constructor(private readonly db: DatabaseSync) {}

  public getSummary(days = 14): AnalyticsSummary {
    const daysWindow = Math.min(90, Math.max(1, Math.floor(Number.isFinite(days) ? days : 14)));
    const now = new Date();
    const todayDay = now.toISOString().slice(0, 10);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    startDate.setUTCDate(startDate.getUTCDate() - (daysWindow - 1));
    const cutoffIso = startDate.toISOString();

    const runAgg = this.db
      .prepare(
        `SELECT
           COUNT(*) AS totalRuns,
           COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedRuns,
           COALESCE(SUM(CASE WHEN status IN ('FAILED', 'BUDGET_EXCEEDED', 'TIMED_OUT') THEN 1 ELSE 0 END), 0) AS failedRuns,
           COALESCE(SUM(CASE WHEN status = 'WAITING_APPROVAL' THEN 1 ELSE 0 END), 0) AS waitingApprovalRuns,
           COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelledRuns,
           AVG(
             CASE
               WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
               THEN (julianday(finished_at) - julianday(started_at)) * 86400000.0
               ELSE NULL
             END
           ) AS avgDurationMs
         FROM runs
         WHERE created_at >= ?`,
      )
      .get(cutoffIso) as RunAggregateRow | undefined;

    const usageAgg = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN mode = 'live' THEN cost_usd ELSE 0 END), 0) AS liveTotalUsd,
           COALESCE(SUM(CASE WHEN mode = 'live' AND substr(created_at, 1, 10) = ? THEN cost_usd ELSE 0 END), 0) AS liveTodayUsd,
           COALESCE(SUM(CASE WHEN mode != 'live' THEN cost_usd ELSE 0 END), 0) AS mockTotalUsd,
           COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
           COALESCE(SUM(output_tokens), 0) AS totalOutputTokens
         FROM usage_ledger
         WHERE created_at >= ?`,
      )
      .get(todayDay, cutoffIso) as UsageTotalsRow | undefined;

    const approvalAgg = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pendingApprovals,
           COALESCE(SUM(CASE WHEN status = 'EXECUTED' THEN 1 ELSE 0 END), 0) AS executedApprovals,
           COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) AS rejectedApprovals
         FROM approvals
         WHERE created_at >= ?`,
      )
      .get(cutoffIso) as
      | { pendingApprovals: number; executedApprovals: number; rejectedApprovals: number }
      | undefined;

    const auditAgg = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('DENIED', 'BLOCKED') THEN 1 ELSE 0 END), 0) AS deniedAuditEvents,
           COALESCE(SUM(CASE WHEN action = 'schedule.rate_limited' THEN 1 ELSE 0 END), 0) AS rateLimitedEvents
         FROM audit_logs
         WHERE created_at >= ?`,
      )
      .get(cutoffIso) as { deniedAuditEvents: number; rateLimitedEvents: number } | undefined;

    const totalRuns = Number(runAgg?.totalRuns ?? 0);
    const completedRuns = Number(runAgg?.completedRuns ?? 0);
    const failedRuns = Number(runAgg?.failedRuns ?? 0);
    const waitingApprovalRuns = Number(runAgg?.waitingApprovalRuns ?? 0);
    const cancelledRuns = Number(runAgg?.cancelledRuns ?? 0);
    const finishedCount = completedRuns + failedRuns + cancelledRuns;
    const successRatePct =
      finishedCount > 0 ? Math.round((completedRuns / finishedCount) * 1000) / 10 : 0;

    // Contiguous ascending daily series (separating run counts & usage ledger sums to prevent join multiplication)
    const dayMap = new Map<
      string,
      {
        day: string;
        runsCount: number;
        completedCount: number;
        failedCount: number;
        liveCostUsd: number;
        mockCostUsd: number;
      }
    >();
    for (let i = 0; i < daysWindow; i += 1) {
      const d = new Date(startDate.getTime());
      d.setUTCDate(startDate.getUTCDate() + i);
      const dayStr = d.toISOString().slice(0, 10);
      dayMap.set(dayStr, {
        day: dayStr,
        runsCount: 0,
        completedCount: 0,
        failedCount: 0,
        liveCostUsd: 0,
        mockCostUsd: 0,
      });
    }

    const dailyRunRows = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                COUNT(*) AS runsCount,
                COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedCount,
                COALESCE(SUM(CASE WHEN status IN ('FAILED', 'BUDGET_EXCEEDED', 'TIMED_OUT') THEN 1 ELSE 0 END), 0) AS failedCount
         FROM runs
         WHERE created_at >= ?
         GROUP BY day`,
      )
      .all(cutoffIso) as Array<{
      day: string;
      runsCount: number;
      completedCount: number;
      failedCount: number;
    }>;

    for (const row of dailyRunRows) {
      const bucket = dayMap.get(row.day);
      if (bucket) {
        bucket.runsCount = Number(row.runsCount ?? 0);
        bucket.completedCount = Number(row.completedCount ?? 0);
        bucket.failedCount = Number(row.failedCount ?? 0);
      }
    }

    const dailyUsageRows = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                COALESCE(SUM(CASE WHEN mode = 'live' THEN cost_usd ELSE 0 END), 0) AS liveCostUsd,
                COALESCE(SUM(CASE WHEN mode != 'live' THEN cost_usd ELSE 0 END), 0) AS mockCostUsd
         FROM usage_ledger
         WHERE created_at >= ?
         GROUP BY day`,
      )
      .all(cutoffIso) as Array<{ day: string; liveCostUsd: number; mockCostUsd: number }>;

    for (const row of dailyUsageRows) {
      const bucket = dayMap.get(row.day);
      if (bucket) {
        bucket.liveCostUsd = Number(row.liveCostUsd ?? 0);
        bucket.mockCostUsd = Number(row.mockCostUsd ?? 0);
      }
    }

    // Employee breakdown
    const empRunRows = this.db
      .prepare(
        `SELECT employee_id AS employeeId,
                COUNT(*) AS runsCount,
                COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedCount,
                COALESCE(SUM(CASE WHEN status IN ('FAILED', 'BUDGET_EXCEEDED', 'TIMED_OUT') THEN 1 ELSE 0 END), 0) AS failedCount
         FROM runs
         WHERE created_at >= ?
         GROUP BY employee_id`,
      )
      .all(cutoffIso) as Array<{
      employeeId: string;
      runsCount: number;
      completedCount: number;
      failedCount: number;
    }>;

    const empUsageRows = this.db
      .prepare(
        `SELECT employee_id AS employeeId,
                COALESCE(SUM(CASE WHEN mode = 'live' THEN cost_usd ELSE 0 END), 0) AS liveCostUsd,
                COALESCE(SUM(CASE WHEN mode != 'live' THEN cost_usd ELSE 0 END), 0) AS mockCostUsd,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_ledger
         WHERE created_at >= ?
         GROUP BY employee_id`,
      )
      .all(cutoffIso) as Array<{
      employeeId: string;
      liveCostUsd: number;
      mockCostUsd: number;
      inputTokens: number;
      outputTokens: number;
    }>;

    const empMap = new Map<
      string,
      AnalyticsSummary["byEmployee"][number]
    >();
    for (const r of empRunRows) {
      empMap.set(r.employeeId, {
        employeeId: r.employeeId,
        runsCount: Number(r.runsCount ?? 0),
        completedCount: Number(r.completedCount ?? 0),
        failedCount: Number(r.failedCount ?? 0),
        liveCostUsd: 0,
        mockCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    for (const u of empUsageRows) {
      const existing = empMap.get(u.employeeId) ?? {
        employeeId: u.employeeId,
        runsCount: 0,
        completedCount: 0,
        failedCount: 0,
        liveCostUsd: 0,
        mockCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      existing.liveCostUsd = Number(u.liveCostUsd ?? 0);
      existing.mockCostUsd = Number(u.mockCostUsd ?? 0);
      existing.inputTokens = Number(u.inputTokens ?? 0);
      existing.outputTokens = Number(u.outputTokens ?? 0);
      empMap.set(u.employeeId, existing);
    }

    // Project breakdown
    const projRunRows = this.db
      .prepare(
        `SELECT COALESCE(project_id, '__company__') AS projectId,
                COUNT(*) AS runsCount,
                COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedCount
         FROM runs
         WHERE created_at >= ?
         GROUP BY projectId`,
      )
      .all(cutoffIso) as Array<{ projectId: string; runsCount: number; completedCount: number }>;

    const projUsageRows = this.db
      .prepare(
        `SELECT COALESCE(project_id, '__company__') AS projectId,
                COALESCE(SUM(CASE WHEN mode = 'live' THEN cost_usd ELSE 0 END), 0) AS liveCostUsd
         FROM usage_ledger
         WHERE created_at >= ?
         GROUP BY projectId`,
      )
      .all(cutoffIso) as Array<{ projectId: string; liveCostUsd: number }>;

    const projMap = new Map<string, AnalyticsSummary["byProject"][number]>();
    for (const p of projRunRows) {
      projMap.set(p.projectId, {
        projectId: p.projectId,
        runsCount: Number(p.runsCount ?? 0),
        completedCount: Number(p.completedCount ?? 0),
        liveCostUsd: 0,
      });
    }
    for (const pu of projUsageRows) {
      const existing = projMap.get(pu.projectId) ?? {
        projectId: pu.projectId,
        runsCount: 0,
        completedCount: 0,
        liveCostUsd: 0,
      };
      existing.liveCostUsd = Number(pu.liveCostUsd ?? 0);
      projMap.set(pu.projectId, existing);
    }

    // Provider breakdown
    const provRunRows = this.db
      .prepare(
        `SELECT runtime_provider AS provider, mode, COUNT(*) AS runsCount
         FROM runs
         WHERE created_at >= ?
         GROUP BY runtime_provider, mode`,
      )
      .all(cutoffIso) as Array<{ provider: string; mode: string; runsCount: number }>;

    const provUsageRows = this.db
      .prepare(
        `SELECT provider, mode,
                COALESCE(SUM(cost_usd), 0) AS costUsd,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_ledger
         WHERE created_at >= ?
         GROUP BY provider, mode`,
      )
      .all(cutoffIso) as Array<{
      provider: string;
      mode: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
    }>;

    const provMap = new Map<string, AnalyticsSummary["byProvider"][number]>();
    for (const pr of provRunRows) {
      const key = `${pr.provider}::${pr.mode}`;
      provMap.set(key, {
        provider: pr.provider,
        mode: pr.mode,
        runsCount: Number(pr.runsCount ?? 0),
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    for (const pu of provUsageRows) {
      const key = `${pu.provider}::${pu.mode}`;
      const existing = provMap.get(key) ?? {
        provider: pu.provider,
        mode: pu.mode,
        runsCount: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      existing.costUsd = Number(pu.costUsd ?? 0);
      existing.inputTokens = Number(pu.inputTokens ?? 0);
      existing.outputTokens = Number(pu.outputTokens ?? 0);
      provMap.set(key, existing);
    }

    const securitySignals = this.db
      .prepare(
        `SELECT action, status, COUNT(*) AS count
         FROM audit_logs
         WHERE created_at >= ?
           AND (
             status IN ('DENIED', 'BLOCKED')
             OR action IN ('schedule.rate_limited', 'telegram.unauthorized_chat', 'policy.denied')
           )
         GROUP BY action, status
         ORDER BY count DESC`,
      )
      .all(cutoffIso) as Array<{ action: string; status: string; count: number }>;

    const prevStartDate = new Date(startDate.getTime());
    prevStartDate.setUTCDate(prevStartDate.getUTCDate() - daysWindow);
    const prevStartIso = prevStartDate.toISOString();

    const prevRunAgg = this.db
      .prepare(
        `SELECT
           COUNT(*) AS totalRuns,
           COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedRuns,
           COALESCE(SUM(CASE WHEN status IN ('FAILED', 'BUDGET_EXCEEDED', 'TIMED_OUT') THEN 1 ELSE 0 END), 0) AS failedRuns,
           COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelledRuns
         FROM runs
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(prevStartIso, cutoffIso) as
      | { totalRuns: number; completedRuns: number; failedRuns: number; cancelledRuns: number }
      | undefined;

    const prevUsageAgg = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN mode = 'live' THEN cost_usd ELSE 0 END), 0) AS liveTotalUsd
         FROM usage_ledger
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(prevStartIso, cutoffIso) as { liveTotalUsd: number } | undefined;

    const prevRuns = Number(prevRunAgg?.totalRuns ?? 0);
    const prevCompleted = Number(prevRunAgg?.completedRuns ?? 0);
    const prevFinished =
      prevCompleted + Number(prevRunAgg?.failedRuns ?? 0) + Number(prevRunAgg?.cancelledRuns ?? 0);
    const prevSuccessRatePct =
      prevFinished > 0 ? Math.round((prevCompleted / prevFinished) * 1000) / 10 : 0;
    const prevLiveUsd = Number(prevUsageAgg?.liveTotalUsd ?? 0);
    const liveTotalUsd = Number(usageAgg?.liveTotalUsd ?? 0);

    const runsDeltaPct =
      prevRuns > 0
        ? Math.round(((totalRuns - prevRuns) / prevRuns) * 1000) / 10
        : totalRuns > 0
          ? 100
          : 0;
    const liveUsdDeltaPct =
      prevLiveUsd > 0
        ? Math.round(((liveTotalUsd - prevLiveUsd) / prevLiveUsd) * 1000) / 10
        : liveTotalUsd > 0
          ? 100
          : 0;
    const successRateDeltaPts = Math.round((successRatePct - prevSuccessRatePct) * 10) / 10;

    return {
      generatedAt: now.toISOString(),
      daysWindow,
      totals: {
        totalRuns,
        completedRuns,
        failedRuns,
        waitingApprovalRuns,
        cancelledRuns,
        successRatePct,
        avgDurationMs: Math.round(Number(runAgg?.avgDurationMs ?? 0)),
        liveTotalUsd,
        liveTodayUsd: Number(usageAgg?.liveTodayUsd ?? 0),
        mockTotalUsd: Number(usageAgg?.mockTotalUsd ?? 0),
        totalInputTokens: Number(usageAgg?.totalInputTokens ?? 0),
        totalOutputTokens: Number(usageAgg?.totalOutputTokens ?? 0),
        pendingApprovals: Number(approvalAgg?.pendingApprovals ?? 0),
        executedApprovals: Number(approvalAgg?.executedApprovals ?? 0),
        rejectedApprovals: Number(approvalAgg?.rejectedApprovals ?? 0),
        deniedAuditEvents: Number(auditAgg?.deniedAuditEvents ?? 0),
        rateLimitedEvents: Number(auditAgg?.rateLimitedEvents ?? 0),
      },
      baselineDelta: {
        previousRuns: prevRuns,
        runsDeltaPct,
        previousLiveUsd: prevLiveUsd,
        liveUsdDeltaPct,
        previousSuccessRatePct: prevSuccessRatePct,
        successRateDeltaPts,
      },
      dailySeries: Array.from(dayMap.values()),
      byEmployee: Array.from(empMap.values()).sort((a, b) => b.runsCount - a.runsCount),
      byProject: Array.from(projMap.values()).sort((a, b) => b.runsCount - a.runsCount),
      byProvider: Array.from(provMap.values()).sort((a, b) => b.runsCount - a.runsCount),
      securitySignals: securitySignals.map((s) => ({
        action: s.action,
        status: s.status,
        count: Number(s.count ?? 0),
      })),
    };
  }
}
