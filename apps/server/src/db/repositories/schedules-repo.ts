import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  RunMode,
  ScheduledJob,
  ScheduledJobRunRecord,
} from "@virtual-office/shared";

export class SchedulesRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: {
    id?: string;
    name: string;
    cronExpression: string;
    employeeId: string;
    projectId?: string | null;
    prompt: string;
    mode: RunMode;
    riskTier: "tier1_auto" | "tier2_guarded";
    enabled: boolean;
    maxRunsPerDay: number;
    nextRunAt: string | null;
  }): ScheduledJob {
    const now = new Date().toISOString();
    const id = input.id ?? `sched-${crypto.randomUUID().slice(0, 12)}`;
    this.db
      .prepare(
        `INSERT INTO scheduled_jobs (
          id, name, cron_expression, employee_id, project_id, prompt, mode, risk_tier,
          enabled, max_runs_per_day, runs_today_count, last_run_day, last_run_id,
          last_run_status, last_run_at, next_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.cronExpression,
        input.employeeId,
        input.projectId ?? null,
        input.prompt,
        input.mode,
        input.riskTier,
        input.enabled ? 1 : 0,
        input.maxRunsPerDay,
        0,
        null,
        null,
        null,
        null,
        input.nextRunAt,
        now,
        now,
      );
    return this.getById(id)!;
  }

  public getById(id: string): ScheduledJob | null {
    const row = this.db
      .prepare("SELECT * FROM scheduled_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapJob(row) : null;
  }

  public list(): ScheduledJob[] {
    const rows = this.db
      .prepare("SELECT * FROM scheduled_jobs ORDER BY created_at DESC, rowid DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapJob(r));
  }

  public update(
    id: string,
    patch: Partial<{
      name: string;
      cronExpression: string;
      employeeId: string;
      projectId: string | null;
      prompt: string;
      mode: RunMode;
      riskTier: "tier1_auto" | "tier2_guarded";
      enabled: boolean;
      maxRunsPerDay: number;
      runsTodayCount: number;
      lastRunDay: string | null;
      lastRunId: string | null;
      lastRunStatus: string | null;
      lastRunAt: string | null;
      nextRunAt: string | null;
    }>,
  ): ScheduledJob | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const next: ScheduledJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE scheduled_jobs SET
           name = ?, cron_expression = ?, employee_id = ?, project_id = ?, prompt = ?,
           mode = ?, risk_tier = ?, enabled = ?, max_runs_per_day = ?,
           runs_today_count = ?, last_run_day = ?, last_run_id = ?,
           last_run_status = ?, last_run_at = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.cronExpression,
        next.employeeId,
        next.projectId ?? null,
        next.prompt,
        next.mode,
        next.riskTier,
        next.enabled ? 1 : 0,
        next.maxRunsPerDay,
        next.runsTodayCount,
        next.lastRunDay ?? null,
        next.lastRunId ?? null,
        next.lastRunStatus ?? null,
        next.lastRunAt ?? null,
        next.nextRunAt ?? null,
        next.updatedAt,
        id,
      );
    return this.getById(id);
  }

  public delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public recordJobRun(input: {
    jobId: string;
    runId?: string | null;
    triggerSource: "cron" | "manual";
    status: string;
    summary?: string | null;
  }): ScheduledJobRunRecord {
    const id = `srun-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scheduled_job_runs (id, job_id, run_id, trigger_source, status, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.jobId,
        input.runId ?? null,
        input.triggerSource,
        input.status,
        input.summary ?? null,
        now,
      );
    return {
      id,
      jobId: input.jobId,
      runId: input.runId ?? null,
      triggerSource: input.triggerSource,
      status: input.status,
      summary: input.summary ?? null,
      createdAt: now,
    };
  }

  public getJobRunByRunId(runId: string): ScheduledJobRunRecord | null {
    const row = this.db
      .prepare("SELECT * FROM scheduled_job_runs WHERE run_id = ? LIMIT 1")
      .get(runId) as Record<string, unknown> | undefined;
    return row ? this.mapJobRun(row) : null;
  }

  public updateJobRunByRunId(
    runId: string,
    patch: { status: string; summary?: string | null },
  ): void {
    this.db
      .prepare("UPDATE scheduled_job_runs SET status = ?, summary = COALESCE(?, summary) WHERE run_id = ?")
      .run(patch.status, patch.summary ?? null, runId);
  }

  public listJobRuns(jobId?: string, limit = 40): ScheduledJobRunRecord[] {
    const clamped = Math.min(Math.max(limit, 1), 200);
    const rows = jobId
      ? (this.db
          .prepare(
            "SELECT * FROM scheduled_job_runs WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
          )
          .all(jobId, clamped) as Array<Record<string, unknown>>)
      : (this.db
          .prepare("SELECT * FROM scheduled_job_runs ORDER BY created_at DESC, rowid DESC LIMIT ?")
          .all(clamped) as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapJobRun(r));
  }

  private mapJob(row: Record<string, unknown>): ScheduledJob {
    return {
      id: String(row.id),
      name: String(row.name),
      cronExpression: String(row.cron_expression),
      employeeId: String(row.employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      prompt: String(row.prompt),
      mode: String(row.mode) as RunMode,
      riskTier: String(row.risk_tier) as "tier1_auto" | "tier2_guarded",
      enabled: Number(row.enabled ?? 1) === 1,
      maxRunsPerDay: Number(row.max_runs_per_day ?? 6),
      runsTodayCount: Number(row.runs_today_count ?? 0),
      lastRunDay: row.last_run_day ? String(row.last_run_day) : null,
      lastRunId: row.last_run_id ? String(row.last_run_id) : null,
      lastRunStatus: row.last_run_status ? String(row.last_run_status) : null,
      lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
      nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapJobRun(row: Record<string, unknown>): ScheduledJobRunRecord {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      runId: row.run_id ? String(row.run_id) : null,
      triggerSource: String(row.trigger_source) as "cron" | "manual",
      status: String(row.status),
      summary: row.summary ? String(row.summary) : null,
      createdAt: String(row.created_at),
    };
  }
}
