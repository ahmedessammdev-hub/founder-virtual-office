import { EventEmitter } from "node:events";
import {
  CreateTaskPlanInputSchema,
  redactSecrets,
  type CreateTaskPlanInput,
  type LoadedEmployee,
  type PlanNode,
  type PlanNodeInput,
  type Run,
  type TaskPlan,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { TaskPlansRepository } from "../db/repositories/orchestration-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { JobSupervisor } from "../runtime/job-supervisor.js";

/**
 * Validates DAG structure: unique nodeKeys, valid dependency targets,
 * no self-dependencies, and zero cycles via Kahn's topological sort.
 */
export function validateDagNodes(
  steps: Array<Pick<PlanNodeInput, "nodeKey" | "title" | "dependsOn" | "assignedEmployeeId">>,
): string[] {
  const keys = steps.map((s, idx) => s.nodeKey ?? `step-${idx + 1}`);
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size !== keys.length) {
    throw new Error("Invalid DAG: duplicate nodeKey detected.");
  }

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const key of keys) {
    adj.set(key, []);
    inDegree.set(key, 0);
  }

  for (let i = 0; i < steps.length; i += 1) {
    const key = keys[i]!;
    const deps = steps[i]!.dependsOn ?? [];
    for (const dep of deps) {
      if (dep === key) {
        throw new Error(`Invalid DAG: step "${key}" cannot depend on itself.`);
      }
      if (!uniqueKeys.has(dep)) {
        throw new Error(`Invalid DAG: step "${key}" depends on unknown node "${dep}".`);
      }
      adj.get(dep)!.push(key);
      inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [key, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(key);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    order.push(curr);
    for (const next of adj.get(curr) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  if (order.length !== keys.length) {
    throw new Error("Invalid DAG: cycle detected in task dependencies.");
  }
  return order;
}

/**
 * Deterministically decomposes a founder goal into a multi-specialist parallel DAG
 * using live employees available in the company directory.
 */
export function decomposeGoalToDag(
  goal: string,
  employees: LoadedEmployee[],
  projectName?: string | null,
): Array<PlanNodeInput> {
  const hasEmp = (id: string) => employees.some((e) => e.profile.id === id);
  const gmId =
    employees.find((e) => e.profile.isOrchestrator)?.profile.id ??
    employees[0]?.profile.id ??
    "general-manager";

  const scopeHint = projectName ? ` (${projectName})` : "";
  const nodes: PlanNodeInput[] = [];
  const parallelDeps: string[] = [];

  if (hasEmp("product-strategist")) {
    nodes.push({
      nodeKey: "product-spec",
      title: `تحديد نطاق ومتطلبات الهدف${scopeHint}`,
      description: `حلّل الهدف التالي وحدد النطاق، المتطلبات الأساسية، ومعايير القبول بدقة: ${goal}`,
      assignedEmployeeId: "product-strategist",
      dependsOn: [],
      riskTier: "tier1_auto",
    });
    parallelDeps.push("product-spec");
  }

  if (hasEmp("senior-engineer")) {
    nodes.push({
      nodeKey: "engineering-plan",
      title: `تصميم الخطة التقنية والمعمارية${scopeHint}`,
      description: `ضع التصور التقني، الملفات المستهدفة، والمخاطر الهندسية للهدف: ${goal}`,
      assignedEmployeeId: "senior-engineer",
      dependsOn: [],
      riskTier: "tier1_auto",
    });
    parallelDeps.push("engineering-plan");
  }

  if (hasEmp("growth-marketer")) {
    nodes.push({
      nodeKey: "growth-launch",
      title: `خطة الرسائل والوصول${scopeHint}`,
      description: `اقترح خطة التموضع، الرسائل الرئيسية، ومؤشرات الأداء للهدف: ${goal}`,
      assignedEmployeeId: "growth-marketer",
      dependsOn: hasEmp("product-strategist") ? ["product-spec"] : [],
      riskTier: "tier1_auto",
    });
    parallelDeps.push("growth-launch");
  }

  const customSpecialist = employees.find(
    (e) =>
      ![
        "general-manager",
        "hr-talent",
        "product-strategist",
        "senior-engineer",
        "growth-marketer",
      ].includes(e.profile.id),
  );
  if (customSpecialist) {
    const key = `specialist-${customSpecialist.profile.id}`;
    nodes.push({
      nodeKey: key,
      title: `مراجعة ${customSpecialist.profile.nameAr}: ${customSpecialist.profile.roleAr}`,
      description: `قدّم مراجعتك التخصصية وملاحظات الجودة لهذا الهدف: ${goal}`,
      assignedEmployeeId: customSpecialist.profile.id,
      dependsOn: [],
      riskTier: "tier1_auto",
    });
    parallelDeps.push(key);
  }

  nodes.push({
    nodeKey: "executive-synthesis",
    title: `التجميع التنفيذي وخارطة التنفيذ${scopeHint}`,
    description: `ادمج مخرجات الفريق أعلاه في ملخص تنفيذي موحّد وخطوات تنفيذ واضحة للهدف: ${goal}`,
    assignedEmployeeId: gmId,
    dependsOn: parallelDeps,
    riskTier: "tier1_auto",
  });

  return nodes;
}

export class OrchestratorDagEngine {
  public readonly bus = new EventEmitter();
  private readonly mockScenarioByPlan = new Map<string, string | undefined>();
  private readonly onRunFinishedHandler: (payload: { runId: string }) => void;
  private readonly onRunStatusHandler: (payload: { run: Run }) => void;
  private closed = false;

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly plansRepo: TaskPlansRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly runsRepo: RunsRepository,
    private readonly auditRepo: AuditRepository,
    private readonly supervisor: JobSupervisor,
  ) {
    this.onRunFinishedHandler = ({ runId }) => {
      if (!this.closed) {
        this.handleRunTerminal(runId);
      }
    };
    this.onRunStatusHandler = ({ run }) => {
      if (this.closed) return;
      if (
        run.status === "COMPLETED" ||
        run.status === "FAILED" ||
        run.status === "CANCELLED" ||
        run.status === "TIMED_OUT" ||
        run.status === "BUDGET_EXCEEDED" ||
        run.status === "WAITING_APPROVAL"
      ) {
        this.handleRunTerminal(run.id);
      }
    };

    this.supervisor.bus.on("run_finished", this.onRunFinishedHandler);
    this.supervisor.bus.on("run_status", this.onRunStatusHandler);
  }

  public shutdown(): void {
    this.closed = true;
    this.supervisor.bus.off("run_finished", this.onRunFinishedHandler);
    this.supervisor.bus.off("run_status", this.onRunStatusHandler);
    this.mockScenarioByPlan.clear();
  }

  public createPlan(rawInput: CreateTaskPlanInput): TaskPlan {
    const input = CreateTaskPlanInputSchema.parse(rawInput);
    const employees = this.companyStore.listEmployees();
    const project = input.projectId ? this.companyStore.getProject(input.projectId) : null;
    if (input.projectId && !project) {
      throw new Error(`Project "${input.projectId}" does not exist.`);
    }
    if (!this.companyStore.getEmployee(input.orchestratorEmployeeId)) {
      throw new Error(`Orchestrator employee "${input.orchestratorEmployeeId}" does not exist.`);
    }

    const rawSteps =
      input.steps && input.steps.length > 0
        ? input.steps.map((s, idx) => ({
            nodeKey: s.nodeKey ?? `step-${idx + 1}`,
            title: s.title,
            description: s.description ?? "",
            assignedEmployeeId: s.assignedEmployeeId,
            dependsOn: s.dependsOn ?? [],
            riskTier: s.riskTier ?? ("tier1_auto" as const),
            providerOverride: s.providerOverride ?? null,
            modelOverride: s.modelOverride ?? null,
          }))
        : decomposeGoalToDag(input.goal, employees, project?.name).map((s, idx) => ({
            nodeKey: s.nodeKey ?? `step-${idx + 1}`,
            title: s.title,
            description: s.description ?? "",
            assignedEmployeeId: s.assignedEmployeeId,
            dependsOn: s.dependsOn ?? [],
            riskTier: s.riskTier ?? ("tier1_auto" as const),
            providerOverride: s.providerOverride ?? null,
            modelOverride: s.modelOverride ?? null,
          }));

    for (const step of rawSteps) {
      const emp = this.companyStore.getEmployee(step.assignedEmployeeId);
      if (!emp) {
        throw new Error(`Assigned employee "${step.assignedEmployeeId}" does not exist.`);
      }
      if (
        input.projectId &&
        emp.permissions.allowedProjectIds !== "*" &&
        !emp.permissions.allowedProjectIds.includes(input.projectId)
      ) {
        throw new Error(
          `Employee "${step.assignedEmployeeId}" is not allowed on project "${input.projectId}".`,
        );
      }
    }

    validateDagNodes(rawSteps);

    const planTitle = input.title?.trim() || input.goal.slice(0, 90);
    const rootTask = this.tasksRepo.create({
      projectId: input.projectId ?? null,
      assignedEmployeeId: input.orchestratorEmployeeId,
      title: `[DAG] ${planTitle}`,
      description: input.goal,
      status: input.autoStart ? "in_progress" : "todo",
      priority: "high",
    });

    const nodeInputs = rawSteps.map((step) => {
      const childTask = this.tasksRepo.create({
        projectId: input.projectId ?? null,
        assignedEmployeeId: step.assignedEmployeeId,
        parentTaskId: rootTask.id,
        title: step.title,
        description: step.description,
        status: "todo",
        priority: "medium",
      });
      return {
        ...step,
        taskId: childTask.id,
      };
    });

    const plan = this.plansRepo.createPlanWithNodes({
      title: planTitle,
      goal: input.goal,
      orchestratorEmployeeId: input.orchestratorEmployeeId,
      projectId: input.projectId ?? null,
      rootTaskId: rootTask.id,
      mode: input.mode,
      maxConcurrency: input.maxConcurrency,
      nodes: nodeInputs,
    });

    if (input.mockScenario) {
      this.mockScenarioByPlan.set(plan.id, input.mockScenario);
    }

    this.auditRepo.log({
      actorType: "employee",
      actorId: input.orchestratorEmployeeId,
      action: "plan.created",
      targetType: "task_plan",
      targetId: plan.id,
      status: plan.status,
      details: { nodeCount: plan.nodes.length, maxConcurrency: plan.maxConcurrency },
    });

    this.emitPlanUpdated(plan);

    if (input.autoStart) {
      return this.startPlan(plan.id) ?? plan;
    }
    return plan;
  }

  public startPlan(planId: string): TaskPlan | null {
    const plan = this.plansRepo.getPlanById(planId);
    if (!plan) return null;
    if (plan.status === "COMPLETED" || plan.status === "FAILED" || plan.status === "CANCELLED") {
      return plan;
    }

    const updated = this.plansRepo.updatePlan(planId, { status: "RUNNING" });
    if (updated) {
      this.emitPlanUpdated(updated);
      this.pumpPlan(planId);
    }
    return this.plansRepo.getPlanById(planId);
  }

  public pumpPlan(planId: string): void {
    if (this.closed) return;
    const plan = this.plansRepo.getPlanById(planId);
    if (!plan) return;
    if (
      plan.status === "COMPLETED" ||
      plan.status === "FAILED" ||
      plan.status === "CANCELLED"
    ) {
      return;
    }

    const nodeByKey = new Map(plan.nodes.map((n) => [n.nodeKey, n]));
    const inFlightCount = plan.nodes.filter(
      (n) => n.status === "RUNNING" || n.status === "QUEUED",
    ).length;

    const concurrencyCap = Math.min(
      plan.maxConcurrency,
      this.companyStore.getCompanyConfig().budgets.maxConcurrentRuns,
    );
    let availableSlots = Math.max(0, concurrencyCap - inFlightCount);

    const readyNodes = plan.nodes.filter((node) => {
      if (node.status !== "PENDING") return false;
      return node.dependsOn.every((depKey) => nodeByKey.get(depKey)?.status === "COMPLETED");
    });

    for (const node of readyNodes) {
      if (availableSlots <= 0) break;
      availableSlots -= 1;

      const upstreamContext = node.dependsOn
        .map((depKey) => {
          const dep = nodeByKey.get(depKey);
          if (!dep) return null;
          return `### Upstream Deliverable (${dep.nodeKey}: ${dep.title})\n${dep.outputSummary ?? "(completed)"}`;
        })
        .filter(Boolean)
        .join("\n\n");

      const prompt = [
        `Orchestrated DAG Task (${plan.title})`,
        `Node: ${node.nodeKey} — ${node.title}`,
        `Overall Goal: ${plan.goal}`,
        node.description ? `Instructions: ${node.description}` : "",
        upstreamContext ? `\nUpstream Completed Work:\n${upstreamContext}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const now = new Date().toISOString();
      if (node.taskId) {
        this.tasksRepo.update(node.taskId, { status: "in_progress" });
      }

      try {
        const run = this.supervisor.enqueueRun({
          employeeId: node.assignedEmployeeId,
          projectId: plan.projectId ?? null,
          taskId: node.taskId ?? null,
          prompt,
          mode: plan.mode,
          riskTier: node.riskTier,
          providerOverride: node.providerOverride ?? undefined,
          modelOverride: node.modelOverride ?? undefined,
          mockScenario:
            plan.mode === "mock" ? this.mockScenarioByPlan.get(plan.id) : undefined,
        });

        if (run.status === "BUDGET_EXCEEDED") {
          this.plansRepo.updateNode(node.id, {
            status: "FAILED",
            runId: run.id,
            errorMessage: run.errorMessage ?? "Budget exceeded before starting node",
            startedAt: now,
            finishedAt: new Date().toISOString(),
          });
          if (node.taskId) {
            this.tasksRepo.update(node.taskId, { status: "failed" });
          }
          this.cascadeSkipDependents(plan.id, node.nodeKey);
        } else {
          this.plansRepo.updateNode(node.id, {
            status: run.status === "RUNNING" ? "RUNNING" : "QUEUED",
            runId: run.id,
            startedAt: now,
          });
        }
      } catch (err) {
        this.plansRepo.updateNode(node.id, {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
          startedAt: now,
          finishedAt: new Date().toISOString(),
        });
        if (node.taskId) {
          this.tasksRepo.update(node.taskId, { status: "failed" });
        }
        this.cascadeSkipDependents(plan.id, node.nodeKey);
      }
    }

    this.reconcilePlanState(plan.id);
  }

  public handleRunTerminal(runId: string): void {
    const node = this.plansRepo.getNodeByRunId(runId);
    if (!node) return;
    const run = this.runsRepo.getById(runId);
    if (!run) return;

    const plan = this.plansRepo.getPlanById(node.planId);
    if (!plan || plan.status === "CANCELLED") return;

    if (run.status === "RUNNING" || run.status === "QUEUED" || run.status === "PLANNING") {
      if (node.status !== "RUNNING") {
        this.plansRepo.updateNode(node.id, { status: "RUNNING" });
        const fresh = this.plansRepo.getPlanById(plan.id);
        if (fresh) this.emitPlanUpdated(fresh);
      }
      return;
    }

    if (run.status === "WAITING_APPROVAL") {
      if (node.status !== "WAITING_APPROVAL") {
        this.plansRepo.updateNode(node.id, { status: "WAITING_APPROVAL" });
        if (node.taskId) {
          this.tasksRepo.update(node.taskId, { status: "waiting_approval" });
        }
        const paused = this.plansRepo.updatePlan(plan.id, { status: "PAUSED_APPROVAL" });
        if (paused) this.emitPlanUpdated(paused);
      }
      return;
    }

    const now = new Date().toISOString();
    if (run.status === "COMPLETED") {
      if (node.status !== "COMPLETED") {
        const cleanSummary = redactSecrets(run.finalOutput ?? "Completed.").trim().slice(0, 1400);
        this.plansRepo.updateNode(node.id, {
          status: "COMPLETED",
          outputSummary: cleanSummary,
          finishedAt: now,
        });
        if (node.taskId) {
          this.tasksRepo.update(node.taskId, {
            status: "done",
            deliverables: [cleanSummary.slice(0, 220)],
          });
        }
      }
      if (plan.status === "PAUSED_APPROVAL") {
        this.plansRepo.updatePlan(plan.id, { status: "RUNNING" });
      }
      this.pumpPlan(plan.id);
      return;
    }

    if (run.status === "CANCELLED") {
      if (node.status !== "CANCELLED") {
        this.plansRepo.updateNode(node.id, {
          status: "CANCELLED",
          errorMessage: run.errorMessage ?? "Cancelled",
          finishedAt: now,
        });
        if (node.taskId) this.tasksRepo.update(node.taskId, { status: "cancelled" });
        this.cascadeSkipDependents(plan.id, node.nodeKey);
      }
      this.reconcilePlanState(plan.id);
      return;
    }

    // FAILED / TIMED_OUT / BUDGET_EXCEEDED
    if (node.status !== "FAILED") {
      this.plansRepo.updateNode(node.id, {
        status: "FAILED",
        errorMessage: run.errorMessage ?? run.errorCode ?? "Node failed",
        finishedAt: now,
      });
      if (node.taskId) {
        this.tasksRepo.update(node.taskId, { status: "failed" });
      }
      this.cascadeSkipDependents(plan.id, node.nodeKey);
    }
    this.reconcilePlanState(plan.id);
  }

  public cancelPlan(planId: string): TaskPlan | null {
    const plan = this.plansRepo.getPlanById(planId);
    if (!plan) return null;

    const now = new Date().toISOString();
    for (const node of plan.nodes) {
      if (node.runId && (node.status === "RUNNING" || node.status === "QUEUED")) {
        this.supervisor.cancelRun(node.runId);
      }
      if (
        node.status === "PENDING" ||
        node.status === "QUEUED" ||
        node.status === "RUNNING" ||
        node.status === "WAITING_APPROVAL"
      ) {
        this.plansRepo.updateNode(node.id, {
          status: "CANCELLED",
          errorMessage: "Plan cancelled by founder.",
          finishedAt: now,
        });
        if (node.taskId) {
          this.tasksRepo.update(node.taskId, { status: "cancelled" });
        }
      }
    }

    if (plan.rootTaskId) {
      this.tasksRepo.update(plan.rootTaskId, { status: "cancelled" });
    }

    const cancelled = this.plansRepo.updatePlan(planId, {
      status: "CANCELLED",
      finishedAt: now,
    });
    if (cancelled) {
      this.emitPlanUpdated(cancelled);
      this.auditRepo.log({
        actorType: "human",
        actorId: "founder",
        action: "plan.cancelled",
        targetType: "task_plan",
        targetId: planId,
        status: "CANCELLED",
      });
    }
    return cancelled;
  }

  private cascadeSkipDependents(planId: string, failedNodeKey: string): void {
    const plan = this.plansRepo.getPlanById(planId);
    if (!plan) return;

    const poisoned = new Set<string>([failedNodeKey]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of plan.nodes) {
        if (poisoned.has(node.nodeKey)) continue;
        if (node.dependsOn.some((d) => poisoned.has(d))) {
          poisoned.add(node.nodeKey);
          changed = true;
          if (node.status === "PENDING") {
            this.plansRepo.updateNode(node.id, {
              status: "SKIPPED",
              errorMessage: `Skipped because upstream dependency (${failedNodeKey}) failed.`,
              finishedAt: new Date().toISOString(),
            });
            if (node.taskId) {
              this.tasksRepo.update(node.taskId, { status: "cancelled" });
            }
          }
        }
      }
    }
  }

  private reconcilePlanState(planId: string): void {
    const plan = this.plansRepo.getPlanById(planId);
    if (!plan) return;

    const anyActive = plan.nodes.some(
      (n) => n.status === "PENDING" || n.status === "QUEUED" || n.status === "RUNNING",
    );
    const anyWaitingApproval = plan.nodes.some((n) => n.status === "WAITING_APPROVAL");

    if (anyWaitingApproval) {
      const updated = this.plansRepo.updatePlan(planId, { status: "PAUSED_APPROVAL" });
      if (updated) this.emitPlanUpdated(updated);
      return;
    }

    if (anyActive) {
      this.emitPlanUpdated(plan);
      return;
    }

    // All nodes finished
    const anyFailed = plan.nodes.some((n) => n.status === "FAILED");
    const now = new Date().toISOString();

    if (anyFailed) {
      if (plan.rootTaskId) {
        this.tasksRepo.update(plan.rootTaskId, { status: "failed" });
      }
      const failed = this.plansRepo.updatePlan(planId, {
        status: "FAILED",
        finishedAt: now,
      });
      if (failed) {
        this.emitPlanUpdated(failed);
        this.auditRepo.log({
          actorType: "system",
          actorId: "orchestrator-dag",
          action: "plan.failed",
          targetType: "task_plan",
          targetId: planId,
          status: "FAILED",
        });
      }
      return;
    }

    const synthesisLines = plan.nodes.map(
      (n: PlanNode) => `• [${n.nodeKey}] ${n.title} (${n.assignedEmployeeId}): ${(n.outputSummary ?? "").slice(0, 260)}`,
    );
    const synthesisSummary = redactSecrets(
      `Goal: ${plan.goal}\n\nCompleted Nodes (${plan.nodes.length}):\n${synthesisLines.join("\n")}`,
    );

    if (plan.rootTaskId) {
      this.tasksRepo.update(plan.rootTaskId, {
        status: "done",
        deliverables: [synthesisSummary.slice(0, 400)],
      });
    }

    const completed = this.plansRepo.updatePlan(planId, {
      status: "COMPLETED",
      synthesisSummary,
      finishedAt: now,
    });
    if (completed) {
      this.emitPlanUpdated(completed);
      this.auditRepo.log({
        actorType: "employee",
        actorId: plan.orchestratorEmployeeId,
        action: "plan.completed",
        targetType: "task_plan",
        targetId: planId,
        status: "COMPLETED",
        details: { nodeCount: plan.nodes.length },
      });
    }
  }

  private emitPlanUpdated(plan: TaskPlan): void {
    this.bus.emit("plan_updated", plan);
  }
}
