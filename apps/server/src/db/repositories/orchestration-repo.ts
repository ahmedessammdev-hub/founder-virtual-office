import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  PlanNode,
  PlanNodeStatus,
  RunMode,
  RuntimeProvider,
  TaskPlan,
  TaskPlanStatus,
} from "@virtual-office/shared";

export class TaskPlansRepository {
  constructor(private readonly db: DatabaseSync) {}

  public createPlanWithNodes(input: {
    id?: string;
    title: string;
    goal: string;
    orchestratorEmployeeId: string;
    projectId?: string | null;
    rootTaskId?: string | null;
    mode: RunMode;
    maxConcurrency: number;
    nodes: Array<{
      nodeKey: string;
      taskId?: string | null;
      title: string;
      description: string;
      assignedEmployeeId: string;
      dependsOn: string[];
      riskTier: "tier1_auto" | "tier2_guarded";
      providerOverride?: RuntimeProvider | null;
      modelOverride?: string | null;
    }>;
  }): TaskPlan {
    const now = new Date().toISOString();
    const planId = input.id ?? `plan-${crypto.randomUUID().slice(0, 12)}`;

    this.db
      .prepare(
        `INSERT INTO task_plans (
          id, title, goal, orchestrator_employee_id, project_id, root_task_id,
          mode, max_concurrency, status, synthesis_summary, created_at, updated_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        input.title,
        input.goal,
        input.orchestratorEmployeeId,
        input.projectId ?? null,
        input.rootTaskId ?? null,
        input.mode,
        input.maxConcurrency,
        "DRAFT",
        null,
        now,
        now,
        null,
      );

    const insertNode = this.db.prepare(
      `INSERT INTO task_plan_nodes (
        id, plan_id, node_key, task_id, run_id, title, description,
        assigned_employee_id, depends_on_json, risk_tier, provider_override,
        model_override, status, output_summary, error_message, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const node of input.nodes) {
      insertNode.run(
        `node-${crypto.randomUUID().slice(0, 12)}`,
        planId,
        node.nodeKey,
        node.taskId ?? null,
        null,
        node.title,
        node.description,
        node.assignedEmployeeId,
        JSON.stringify(node.dependsOn),
        node.riskTier,
        node.providerOverride ?? null,
        node.modelOverride ?? null,
        "PENDING",
        null,
        null,
        null,
        null,
      );
    }

    return this.getPlanById(planId)!;
  }

  public getPlanById(id: string): TaskPlan | null {
    const row = this.db
      .prepare("SELECT * FROM task_plans WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const nodeRows = this.db
      .prepare("SELECT * FROM task_plan_nodes WHERE plan_id = ? ORDER BY rowid ASC")
      .all(id) as Array<Record<string, unknown>>;

    return this.mapPlan(row, nodeRows.map((n) => this.mapNode(n)));
  }

  public listPlans(limit = 50): TaskPlan[] {
    const clamped = Math.min(Math.max(limit, 1), 200);
    const rows = this.db
      .prepare("SELECT * FROM task_plans ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(clamped) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const planId = String(row.id);
      const nodeRows = this.db
        .prepare("SELECT * FROM task_plan_nodes WHERE plan_id = ? ORDER BY rowid ASC")
        .all(planId) as Array<Record<string, unknown>>;
      return this.mapPlan(row, nodeRows.map((n) => this.mapNode(n)));
    });
  }

  public updatePlan(
    id: string,
    patch: {
      status?: TaskPlanStatus;
      synthesisSummary?: string | null;
      finishedAt?: string | null;
    },
  ): TaskPlan | null {
    const existing = this.getPlanById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE task_plans SET status = ?, synthesis_summary = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? existing.status,
        patch.synthesisSummary !== undefined
          ? patch.synthesisSummary
          : existing.synthesisSummary ?? null,
        now,
        patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt ?? null,
        id,
      );
    return this.getPlanById(id);
  }

  public getNodeById(nodeId: string): PlanNode | null {
    const row = this.db
      .prepare("SELECT * FROM task_plan_nodes WHERE id = ?")
      .get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : null;
  }

  public getNodeByRunId(runId: string): PlanNode | null {
    const row = this.db
      .prepare("SELECT * FROM task_plan_nodes WHERE run_id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : null;
  }

  public updateNode(
    nodeId: string,
    patch: {
      status?: PlanNodeStatus;
      runId?: string | null;
      outputSummary?: string | null;
      errorMessage?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
    },
  ): PlanNode | null {
    const existing = this.getNodeById(nodeId);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE task_plan_nodes SET
           status = ?,
           run_id = ?,
           output_summary = ?,
           error_message = ?,
           started_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? existing.status,
        patch.runId !== undefined ? patch.runId : existing.runId ?? null,
        patch.outputSummary !== undefined ? patch.outputSummary : existing.outputSummary ?? null,
        patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage ?? null,
        patch.startedAt !== undefined ? patch.startedAt : existing.startedAt ?? null,
        patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt ?? null,
        nodeId,
      );
    return this.getNodeById(nodeId);
  }

  private mapPlan(row: Record<string, unknown>, nodes: PlanNode[]): TaskPlan {
    return {
      id: String(row.id),
      title: String(row.title),
      goal: String(row.goal),
      orchestratorEmployeeId: String(row.orchestrator_employee_id),
      projectId: row.project_id ? String(row.project_id) : null,
      rootTaskId: row.root_task_id ? String(row.root_task_id) : null,
      mode: String(row.mode) as RunMode,
      maxConcurrency: Number(row.max_concurrency ?? 2),
      status: String(row.status) as TaskPlanStatus,
      synthesisSummary: row.synthesis_summary ? String(row.synthesis_summary) : null,
      nodes,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    };
  }

  private mapNode(row: Record<string, unknown>): PlanNode {
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      nodeKey: String(row.node_key),
      taskId: row.task_id ? String(row.task_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      title: String(row.title),
      description: String(row.description ?? ""),
      assignedEmployeeId: String(row.assigned_employee_id),
      dependsOn: JSON.parse(String(row.depends_on_json ?? "[]")) as string[],
      riskTier: String(row.risk_tier) as "tier1_auto" | "tier2_guarded",
      providerOverride: row.provider_override
        ? (String(row.provider_override) as RuntimeProvider)
        : null,
      modelOverride: row.model_override ? String(row.model_override) : null,
      status: String(row.status) as PlanNodeStatus,
      outputSummary: row.output_summary ? String(row.output_summary) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    };
  }
}
