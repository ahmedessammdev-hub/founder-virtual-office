import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateTaskInput, Task, TaskPriority, TaskStatus } from "@virtual-office/shared";

export class TasksRepository {
  constructor(private readonly db: DatabaseSync) {}

  public create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      projectId: input.projectId ?? null,
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      deliverables: [],
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, project_id, assigned_employee_id, parent_task_id, title, description,
          status, priority, deliverables_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId ?? null,
        task.assignedEmployeeId ?? null,
        task.parentTaskId ?? null,
        task.title,
        task.description,
        task.status,
        task.priority,
        JSON.stringify(task.deliverables),
        task.createdAt,
        task.updatedAt,
      );

    return task;
  }

  public getById(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapTask(row) : null;
  }

  public list(filter?: { projectId?: string; status?: TaskStatus }): Task[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapTask(row));
  }

  public update(
    id: string,
    patch: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "assignedEmployeeId" | "deliverables">>,
  ): Task | null {
    const current = this.getById(id);
    if (!current) {
      return null;
    }
    const next: Task = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE tasks
         SET title = ?, description = ?, status = ?, priority = ?, assigned_employee_id = ?, deliverables_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.priority,
        next.assignedEmployeeId ?? null,
        JSON.stringify(next.deliverables),
        next.updatedAt,
        id,
      );

    return next;
  }

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : null,
      assignedEmployeeId: row.assigned_employee_id ? String(row.assigned_employee_id) : null,
      parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
      title: String(row.title),
      description: String(row.description),
      status: String(row.status) as TaskStatus,
      priority: String(row.priority) as TaskPriority,
      deliverables: JSON.parse(String(row.deliverables_json ?? "[]")) as string[],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
