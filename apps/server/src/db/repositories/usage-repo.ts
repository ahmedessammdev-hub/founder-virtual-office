import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RunMode } from "@virtual-office/shared";

export interface UsageEntry {
  id: string;
  runId: string;
  employeeId: string;
  projectId: string | null;
  provider: string;
  model: string;
  mode: RunMode;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export class UsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  public record(input: Omit<UsageEntry, "id" | "createdAt">): UsageEntry {
    const entry: UsageEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    };

    this.db
      .prepare(
        `INSERT INTO usage_ledger (
          id, run_id, employee_id, project_id, provider, model, mode,
          input_tokens, output_tokens, cost_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.runId,
        entry.employeeId,
        entry.projectId ?? null,
        entry.provider,
        entry.model,
        entry.mode,
        entry.inputTokens,
        entry.outputTokens,
        entry.costUsd,
        entry.createdAt,
      );

    return entry;
  }

  private utcDayPrefix(date = new Date()): string {
    return `${date.toISOString().slice(0, 10)}%`;
  }

  /**
   * Aggregates ONLY `mode = 'live'` costs for the current UTC day so mock/dry-run tests
   * never pollute live budgets.
   */
  public getLiveDailySpend(filter: {
    employeeId?: string;
    projectId?: string;
    provider?: string;
  }): number {
    const dayLike = this.utcDayPrefix();
    const clauses = ["mode = 'live'", "created_at LIKE ?"];
    const params: string[] = [dayLike];

    if (filter.employeeId) {
      clauses.push("employee_id = ?");
      params.push(filter.employeeId);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.provider) {
      clauses.push("provider = ?");
      params.push(filter.provider);
    }

    const row = this.db
      .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_ledger WHERE ${clauses.join(" AND ")}`)
      .get(...params) as { total: number } | undefined;

    return Number(row?.total ?? 0);
  }

  public getSummary(): {
    liveTodayUsd: number;
    byEmployee: Array<{ employeeId: string; costUsd: number; inputTokens: number; outputTokens: number }>;
    byProvider: Array<{ provider: string; mode: string; costUsd: number }>;
  } {
    const dayLike = this.utcDayPrefix();
    const liveToday = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_ledger WHERE mode = 'live' AND created_at LIKE ?")
      .get(dayLike) as { total: number };

    const byEmployee = this.db
      .prepare(
        `SELECT employee_id AS employeeId,
                COALESCE(SUM(cost_usd), 0) AS costUsd,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_ledger
         WHERE mode = 'live'
         GROUP BY employee_id`,
      )
      .all() as Array<{ employeeId: string; costUsd: number; inputTokens: number; outputTokens: number }>;

    const byProvider = this.db
      .prepare(
        `SELECT provider, mode, COALESCE(SUM(cost_usd), 0) AS costUsd
         FROM usage_ledger
         GROUP BY provider, mode`,
      )
      .all() as Array<{ provider: string; mode: string; costUsd: number }>;

    return {
      liveTodayUsd: Number(liveToday?.total ?? 0),
      byEmployee,
      byProvider,
    };
  }
}
