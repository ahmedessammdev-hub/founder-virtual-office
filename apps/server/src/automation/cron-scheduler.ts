import { EventEmitter } from "node:events";
import {
  CreateScheduledJobInputSchema,
  UpdateScheduledJobInputSchema,
  redactSecrets,
  type CreateScheduledJobInput,
  type ScheduledJob,
  type UpdateScheduledJobInput,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { SchedulesRepository } from "../db/repositories/schedules-repo.js";
import type { JobSupervisor } from "../runtime/job-supervisor.js";
import { computeNextRunAt, matchesCron, validateCronExpression } from "./cron-parser.js";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}:${date.getMinutes()}`;
}

export class CronScheduler {
  public readonly bus = new EventEmitter();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickIntervalMs: number;
  private readonly enableAutoTick: boolean;
  private readonly onRunFinishedHandler: (payload: { runId: string }) => void;

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly schedulesRepo: SchedulesRepository,
    private readonly runsRepo: RunsRepository,
    private readonly auditRepo: AuditRepository,
    private readonly supervisor: JobSupervisor,
    opts?: { enableAutoTick?: boolean; tickIntervalMs?: number },
  ) {
    this.enableAutoTick = opts?.enableAutoTick ?? false;
    this.tickIntervalMs = opts?.tickIntervalMs ?? 30_000;

    this.onRunFinishedHandler = ({ runId }) => {
      const jobRun = this.schedulesRepo.getJobRunByRunId(runId);
      if (!jobRun) return;
      const run = this.runsRepo.getById(runId);
      if (!run) return;
      const summary = redactSecrets(run.finalOutput ?? run.errorMessage ?? run.status).slice(0, 300);
      this.schedulesRepo.updateJobRunByRunId(runId, { status: run.status, summary });
      const updated = this.schedulesRepo.update(jobRun.jobId, { lastRunStatus: run.status });
      if (updated) {
        this.bus.emit("schedule_updated", updated);
      }
    };

    this.supervisor.bus.on("run_finished", this.onRunFinishedHandler);
    if (this.enableAutoTick) {
      this.start();
    }
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick(new Date());
    }, this.tickIntervalMs);
  }

  public shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.supervisor.bus.off("run_finished", this.onRunFinishedHandler);
  }

  public createJob(rawInput: CreateScheduledJobInput): ScheduledJob {
    const input = CreateScheduledJobInputSchema.parse(rawInput);
    validateCronExpression(input.cronExpression);

    const emp = this.companyStore.getEmployee(input.employeeId);
    if (!emp) {
      throw new Error(`Employee "${input.employeeId}" does not exist.`);
    }
    if (input.projectId && !this.companyStore.getProject(input.projectId)) {
      throw new Error(`Project "${input.projectId}" does not exist.`);
    }

    const nextRunAt = computeNextRunAt(input.cronExpression);
    const job = this.schedulesRepo.create({
      name: input.name.trim(),
      cronExpression: input.cronExpression.trim(),
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      prompt: input.prompt.trim(),
      mode: input.mode,
      riskTier: input.riskTier,
      enabled: input.enabled,
      maxRunsPerDay: input.maxRunsPerDay,
      nextRunAt,
    });

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "schedule.created",
      targetType: "scheduled_job",
      targetId: job.id,
      status: "OK",
      details: { cronExpression: job.cronExpression, employeeId: job.employeeId },
    });

    this.bus.emit("schedule_updated", job);
    return job;
  }

  public updateJob(id: string, rawPatch: UpdateScheduledJobInput): ScheduledJob | null {
    const existing = this.schedulesRepo.getById(id);
    if (!existing) return null;
    const patch = UpdateScheduledJobInputSchema.parse(rawPatch);

    const nextExpr = patch.cronExpression?.trim() ?? existing.cronExpression;
    if (patch.cronExpression) {
      validateCronExpression(nextExpr);
    }
    if (patch.employeeId && !this.companyStore.getEmployee(patch.employeeId)) {
      throw new Error(`Employee "${patch.employeeId}" does not exist.`);
    }

    const nextRunAt = computeNextRunAt(nextExpr);
    const updated = this.schedulesRepo.update(id, {
      ...patch,
      cronExpression: nextExpr,
      nextRunAt,
    });
    if (updated) {
      this.bus.emit("schedule_updated", updated);
    }
    return updated;
  }

  public deleteJob(id: string): boolean {
    const ok = this.schedulesRepo.delete(id);
    if (ok) {
      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "schedule.deleted",
        targetType: "scheduled_job",
        targetId: id,
        status: "OK",
      });
    }
    return ok;
  }

  public triggerJob(
    id: string,
    source: "cron" | "manual",
    now = new Date(),
  ): { triggered: boolean; reason?: string; job: ScheduledJob | null; runId?: string } {
    const job = this.schedulesRepo.getById(id);
    if (!job) {
      return { triggered: false, reason: "Scheduled job not found.", job: null };
    }

    const today = dayKey(now);
    const runsToday = job.lastRunDay === today ? job.runsTodayCount : 0;

    if (runsToday >= job.maxRunsPerDay) {
      const reason = `Daily schedule cap (${runsToday}/${job.maxRunsPerDay}) reached for "${job.name}".`;
      this.schedulesRepo.recordJobRun({
        jobId: job.id,
        triggerSource: source,
        status: "RATE_LIMITED",
        summary: reason,
      });
      this.auditRepo.log({
        actorType: "system",
        actorId: "cron-scheduler",
        action: "schedule.rate_limited",
        targetType: "scheduled_job",
        targetId: job.id,
        status: "BLOCKED",
        details: { runsToday, maxRunsPerDay: job.maxRunsPerDay },
      });
      return { triggered: false, reason, job };
    }

    if (job.lastRunId) {
      const prevRun = this.runsRepo.getById(job.lastRunId);
      if (
        prevRun &&
        (prevRun.status === "RUNNING" || prevRun.status === "QUEUED" || prevRun.status === "PLANNING")
      ) {
        return {
          triggered: false,
          reason: `Previous scheduled run "${prevRun.id}" is still active (${prevRun.status}).`,
          job,
        };
      }
    }

    const run = this.supervisor.enqueueRun({
      employeeId: job.employeeId,
      projectId: job.projectId ?? null,
      prompt: `[Scheduled: ${job.name}]\n${job.prompt}`,
      mode: job.mode,
      riskTier: job.riskTier,
    });

    const nextRunAt = computeNextRunAt(job.cronExpression, now);
    const updated = this.schedulesRepo.update(job.id, {
      runsTodayCount: runsToday + 1,
      lastRunDay: today,
      lastRunId: run.id,
      lastRunStatus: run.status,
      lastRunAt: now.toISOString(),
      nextRunAt,
    });

    this.schedulesRepo.recordJobRun({
      jobId: job.id,
      runId: run.id,
      triggerSource: source,
      status: run.status,
      summary: run.errorMessage ?? `Triggered (${source})`,
    });

    this.auditRepo.log({
      actorType: source === "manual" ? "human" : "system",
      actorId: source === "manual" ? "founder" : "cron-scheduler",
      action: "schedule.triggered",
      targetType: "scheduled_job",
      targetId: job.id,
      status: run.status,
      details: { runId: run.id, source },
    });

    if (updated) {
      this.bus.emit("schedule_updated", updated);
    }

    return { triggered: true, job: updated, runId: run.id };
  }

  public tick(now = new Date()): Array<{ jobId: string; runId?: string; skippedReason?: string }> {
    const jobs = this.schedulesRepo.list();
    const currentBucket = minuteKey(now);
    const outcomes: Array<{ jobId: string; runId?: string; skippedReason?: string }> = [];

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!matchesCron(job.cronExpression, now)) continue;
      if (job.lastRunAt && minuteKey(new Date(job.lastRunAt)) === currentBucket) {
        continue;
      }

      const res = this.triggerJob(job.id, "cron", now);
      outcomes.push({
        jobId: job.id,
        runId: res.runId,
        skippedReason: res.triggered ? undefined : res.reason,
      });
    }

    return outcomes;
  }
}
