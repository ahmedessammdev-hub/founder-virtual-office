import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  CreateMeetingInputSchema,
  redactSecrets,
  type CreateMeetingInput,
  type MeetingActionItem,
  type MeetingRecord,
  type MeetingTurn,
} from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";
import type { CompanyStore } from "../company/company-store.js";
import { assertPathWithinRoots } from "../company/path-guard.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { MeetingsRepository } from "../db/repositories/meetings-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { JobSupervisor } from "../runtime/job-supervisor.js";

function extractKeyPoints(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length >= 6)
    .slice(0, 3)
    .map((line) => line.slice(0, 160));
}

export class MeetingEngine {
  public readonly bus = new EventEmitter();
  private readonly activeMeetings = new Map<
    string,
    { cancelled: boolean; activeRunId?: string; cancelWaiter?: () => void }
  >();
  private closed = false;

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly meetingsRepo: MeetingsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly runsRepo: RunsRepository,
    private readonly auditRepo: AuditRepository,
    private readonly supervisor: JobSupervisor,
  ) {}

  public startMeeting(rawInput: CreateMeetingInput): MeetingRecord {
    const input = CreateMeetingInputSchema.parse(rawInput);

    if (input.projectId && !this.companyStore.getProject(input.projectId)) {
      throw new Error(`Project "${input.projectId}" does not exist.`);
    }
    if (!this.companyStore.getEmployee(input.facilitatorEmployeeId)) {
      throw new Error(`Facilitator employee "${input.facilitatorEmployeeId}" does not exist.`);
    }

    const dedupParticipants = Array.from(new Set(input.participantEmployeeIds));
    if (dedupParticipants.length < 2) {
      throw new Error("A bounded meeting requires at least 2 distinct participants.");
    }
    for (const empId of dedupParticipants) {
      const emp = this.companyStore.getEmployee(empId);
      if (!emp) {
        throw new Error(`Participant employee "${empId}" does not exist.`);
      }
      if (
        input.projectId &&
        emp.permissions.allowedProjectIds !== "*" &&
        !emp.permissions.allowedProjectIds.includes(input.projectId)
      ) {
        throw new Error(`Participant "${empId}" is not permitted on project "${input.projectId}".`);
      }
    }

    const meeting = this.meetingsRepo.create({
      topic: input.topic.trim(),
      agenda: input.agenda.trim(),
      projectId: input.projectId ?? null,
      facilitatorEmployeeId: input.facilitatorEmployeeId,
      participantEmployeeIds: dedupParticipants,
      maxRounds: input.maxRounds,
      mode: input.mode,
      autoCreateTasks: input.autoCreateTasks,
      status: "RUNNING",
    });

    this.auditRepo.log({
      actorType: "employee",
      actorId: meeting.facilitatorEmployeeId,
      action: "meeting.started",
      targetType: "meeting",
      targetId: meeting.id,
      status: "RUNNING",
      details: {
        topic: meeting.topic,
        participants: meeting.participantEmployeeIds,
        maxRounds: meeting.maxRounds,
      },
    });

    this.emitMeetingUpdated(meeting);
    this.activeMeetings.set(meeting.id, { cancelled: false });

    void this.runMeetingLoop(meeting.id, input.mockScenario);
    return meeting;
  }

  public cancelMeeting(meetingId: string): MeetingRecord | null {
    const existing = this.meetingsRepo.getById(meetingId);
    if (!existing) return null;

    const ctrl = this.activeMeetings.get(meetingId);
    if (ctrl) {
      ctrl.cancelled = true;
      if (ctrl.activeRunId) {
        this.supervisor.cancelRun(ctrl.activeRunId);
      }
      ctrl.cancelWaiter?.();
    }

    const cancelled = this.meetingsRepo.update(meetingId, {
      status: "CANCELLED",
      finishedAt: new Date().toISOString(),
    });
    if (cancelled) {
      this.emitMeetingUpdated(cancelled);
      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "meeting.cancelled",
        targetType: "meeting",
        targetId: meetingId,
        status: "CANCELLED",
      });
    }
    return cancelled;
  }

  public shutdown(): void {
    this.closed = true;
    for (const [id, ctrl] of this.activeMeetings.entries()) {
      ctrl.cancelled = true;
      if (ctrl.activeRunId) {
        this.supervisor.cancelRun(ctrl.activeRunId);
      }
      ctrl.cancelWaiter?.();
      this.activeMeetings.delete(id);
    }
  }

  private async runMeetingLoop(meetingId: string, mockScenario?: string): Promise<void> {
    const ctrl = this.activeMeetings.get(meetingId);
    if (!ctrl) return;

    try {
      const initial = this.meetingsRepo.getById(meetingId);
      if (!initial) return;

      const recordedTurns: MeetingTurn[] = [];
      let turnCounter = 0;

      for (let round = 1; round <= initial.maxRounds; round += 1) {
        for (const empId of initial.participantEmployeeIds) {
          if (ctrl.cancelled || this.closed) {
            return;
          }

          const emp = this.companyStore.getEmployee(empId);
          const transcriptDigest = recordedTurns
            .slice(-6)
            .map((t) => `[R${t.round} · ${t.employeeId}]: ${t.summary}`)
            .join("\n");

          const prompt = [
            `Bounded Team Meeting (Round ${round}/${initial.maxRounds}, tier1_auto read-only discussion)`,
            `Topic: ${initial.topic}`,
            initial.agenda ? `Agenda: ${initial.agenda}` : "",
            `Your Role: ${emp?.profile.nameAr ?? empId} (${emp?.profile.role ?? empId})`,
            transcriptDigest
              ? `\nPrevious Discussion Turns:\n${transcriptDigest.slice(0, 1800)}`
              : "\nYou are opening this discussion.",
            "\nProvide 2–3 crisp, actionable points and concrete next action from your role's perspective.",
          ]
            .filter(Boolean)
            .join("\n");

          const run = this.supervisor.enqueueRun({
            employeeId: empId,
            projectId: initial.projectId ?? null,
            prompt,
            mode: initial.mode,
            riskTier: "tier1_auto",
            mockScenario: initial.mode === "mock" ? mockScenario : undefined,
          });

          ctrl.activeRunId = run.id;

          if (
            run.status !== "COMPLETED" &&
            run.status !== "FAILED" &&
            run.status !== "CANCELLED" &&
            run.status !== "BUDGET_EXCEEDED"
          ) {
            await this.waitForRunFinish(run.id, ctrl);
          }

          ctrl.activeRunId = undefined;
          if (ctrl.cancelled || this.closed) {
            return;
          }

          const finishedRun = this.runsRepo.getById(run.id);
          const rawOut =
            finishedRun?.finalOutput ||
            finishedRun?.errorMessage ||
            "No response returned for this turn.";
          const cleanSummary = redactSecrets(rawOut).trim().slice(0, 700);
          const keyPoints = extractKeyPoints(cleanSummary);

          const savedTurn = this.meetingsRepo.appendTurn({
            meetingId,
            round,
            turnIndex: turnCounter,
            employeeId: empId,
            runId: run.id,
            summary: cleanSummary,
            keyPoints,
          });
          turnCounter += 1;
          recordedTurns.push(savedTurn);

          const refreshed = this.meetingsRepo.getById(meetingId);
          if (refreshed) {
            this.emitMeetingUpdated(refreshed);
          }
        }
      }

      if (ctrl.cancelled || this.closed) {
        return;
      }

      // Synthesize bounded decisions + action items
      const decisions = initial.participantEmployeeIds.map((empId, idx) => {
        const lastTurn = [...recordedTurns].reverse().find((t) => t.employeeId === empId);
        const empName = this.companyStore.getEmployee(empId)?.profile.nameAr ?? empId;
        const snippet = lastTurn?.keyPoints[0] ?? lastTurn?.summary.slice(0, 120) ?? initial.topic;
        return `قرار ${idx + 1} (${empName}): ${snippet}`;
      });

      const actionItems: MeetingActionItem[] = initial.participantEmployeeIds.map((empId) => {
        const lastTurn = [...recordedTurns].reverse().find((t) => t.employeeId === empId);
        const empName = this.companyStore.getEmployee(empId)?.profile.nameAr ?? empId;
        const title = `[Meeting] ${initial.topic.slice(0, 42)} — ${empName}`;
        const description =
          lastTurn?.summary.slice(0, 260) || `Follow up on meeting: ${initial.topic}`;

        let taskId: string | null = null;
        if (initial.autoCreateTasks) {
          const created = this.tasksRepo.create({
            projectId: initial.projectId ?? null,
            assignedEmployeeId: empId,
            title,
            description,
            status: "todo",
            priority: "medium",
          });
          taskId = created.id;
        }

        return {
          title,
          description,
          assignedEmployeeId: empId,
          priority: "medium",
          taskId,
        };
      });

      const minutesSummary = redactSecrets(
        [
          `# محضر اجتماع: ${initial.topic}`,
          `- Rounds Completed: ${initial.maxRounds}/${initial.maxRounds}`,
          `- Participants: ${initial.participantEmployeeIds.join(", ")}`,
          "",
          "## القرارات المعتمدة (Decisions)",
          ...decisions.map((d) => `- ${d}`),
          "",
          "## بنود العمل (Action Items)",
          ...actionItems.map(
            (a) => `- [${a.assignedEmployeeId}] ${a.title}${a.taskId ? ` (Task: ${a.taskId})` : ""}`,
          ),
        ].join("\n"),
      );

      // Save deliverable inside company/deliverables cleanly
      const deliverablesBase = path.join(this.companyStore.companyRoot, "deliverables");
      const bucketDir = path.join(deliverablesBase, initial.projectId ?? "general");
      fs.mkdirSync(bucketDir, { recursive: true });
      const deliverablePath = assertPathWithinRoots(
        path.join(bucketDir, `${meetingId}.md`),
        [deliverablesBase],
      );
      atomicWriteFile(deliverablePath, `${minutesSummary}\n`);

      const completed = this.meetingsRepo.update(meetingId, {
        status: "COMPLETED",
        decisions,
        actionItems,
        minutesSummary,
        finishedAt: new Date().toISOString(),
      });

      if (completed) {
        this.emitMeetingUpdated(completed);
        this.auditRepo.log({
          actorType: "employee",
          actorId: completed.facilitatorEmployeeId,
          action: "meeting.completed",
          targetType: "meeting",
          targetId: meetingId,
          status: "COMPLETED",
          details: {
            turns: completed.turns.length,
            actionItemsCreated: actionItems.filter((a) => Boolean(a.taskId)).length,
          },
        });
      }
    } catch (err) {
      if (!ctrl.cancelled && !this.closed) {
        const failed = this.meetingsRepo.update(meetingId, {
          status: "FAILED",
          minutesSummary: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        });
        if (failed) this.emitMeetingUpdated(failed);
      }
    } finally {
      this.activeMeetings.delete(meetingId);
    }
  }

  private waitForRunFinish(
    runId: string,
    ctrl: { cancelled: boolean; cancelWaiter?: () => void },
  ): Promise<void> {
    const already = this.runsRepo.getById(runId);
    if (
      already &&
      [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "BUDGET_EXCEEDED",
        "WAITING_APPROVAL",
      ].includes(already.status)
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        this.supervisor.bus.off("run_finished", onFinish);
        ctrl.cancelWaiter = undefined;
        resolve();
      };
      const onFinish = (payload: { runId: string }): void => {
        if (payload.runId === runId) {
          done();
        }
      };
      ctrl.cancelWaiter = done;
      this.supervisor.bus.on("run_finished", onFinish);
    });
  }

  private emitMeetingUpdated(meeting: MeetingRecord): void {
    this.bus.emit("meeting_updated", meeting);
  }
}
