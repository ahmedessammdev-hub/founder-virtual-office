import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import {
  CRON_PRESETS,
  computeNextRunAt,
  matchesCron,
  validateCronExpression,
} from "../src/automation/index.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

async function waitFor<T>(
  check: () => T | undefined | null | false,
  timeoutMs = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = check();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe("Phase 5 Cron Parser & Scheduler Engine", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function bootServer(): Promise<{ ctx: OfficeAppContext; baseUrl: string }> {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      enableAutomationPollers: false,
      probeProvidersOnBoot: false,
    });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = ctx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    cleanups.push(async () => {
      await ctx.close();
      tmp.cleanup();
    });
    return { ctx, baseUrl: `http://127.0.0.1:${port}` };
  }

  it("validates 5-field cron expressions, handles Sunday 7->0, and computes nextRunAt", () => {
    expect(CRON_PRESETS.length).toBeGreaterThanOrEqual(4);

    const step = validateCronExpression("*/5 * * * *");
    expect(step.minutes.has(0)).toBe(true);
    expect(step.minutes.has(15)).toBe(true);
    expect(step.minutes.has(17)).toBe(false);
    expect(step.hours.size).toBe(24);

    const weekdays = validateCronExpression("30 9 * * 1-5");
    expect(weekdays.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));

    // Sunday normalized from 7 -> 0 (2026-11-22 is Sunday)
    const sundayNoon = new Date(2026, 10, 22, 12, 0, 0);
    expect(matchesCron("0 12 * * 7", sundayNoon)).toBe(true);
    expect(matchesCron("0 12 * * 0", sundayNoon)).toBe(true);
    expect(matchesCron("0 12 * * 1", sundayNoon)).toBe(false);

    const base = new Date(2026, 10, 22, 9, 2, 0);
    const nextIso = computeNextRunAt("*/15 * * * *", base);
    expect(nextIso).toBeTruthy();
    expect(new Date(nextIso!).getMinutes()).toBe(15);

    expect(() => validateCronExpression("* * *")).toThrow(/5 fields/);
    expect(() => validateCronExpression("60 * * * *")).toThrow(/out of range/);
    expect(() => validateCronExpression("0 25 * * *")).toThrow(/out of range/);
    expect(() => validateCronExpression("0 9 * * 8")).toThrow(/out of range/);
    expect(() => validateCronExpression("foo * * * *")).toThrow();
  });

  it("enforces minute-bucket deduplication, overlap guard, daily maxRunsPerDay cap, and CRUD lifecycle", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Invalid cron rejected with HTTP 400
    const badResp = await fetch(`${baseUrl}/api/schedules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Broken Schedule",
        cronExpression: "99 * * *",
        employeeId: "general-manager",
        prompt: "Should fail validation",
        mode: "mock",
      }),
    });
    expect(badResp.status).toBe(400);

    // 2. Create valid Mock schedule capped at maxRunsPerDay = 2
    const createResp = await fetch(`${baseUrl}/api/schedules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Every 5 Min Pulse",
        cronExpression: "*/5 * * * *",
        employeeId: "general-manager",
        prompt: "Report sprint status in concise bullet points.",
        mode: "mock",
        riskTier: "tier1_auto",
        enabled: true,
        maxRunsPerDay: 2,
      }),
    });
    expect(createResp.status).toBe(201);
    const { job } = (await createResp.json()) as {
      job: { id: string; nextRunAt: string | null; runsTodayCount: number };
    };
    expect(job.nextRunAt).toBeTruthy();
    expect(job.runsTodayCount).toBe(0);

    // 3. tick() triggers once inside matching minute and dedupes repeated tick() calls in same minute
    const now = new Date();
    const matchMinute = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 15, 0),
    );
    const firstTick = ctx.cronScheduler.tick(matchMinute);
    expect(firstTick).toHaveLength(1);
    expect(firstTick[0]!.runId).toBeTruthy();

    const duplicateTick = ctx.cronScheduler.tick(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 15, 45)),
    );
    expect(duplicateTick).toHaveLength(0);

    await waitFor(() => {
      const r = ctx.repos.runs.getById(firstTick[0]!.runId!);
      return r?.status === "COMPLETED" ? r : null;
    });

    // 4. Manual Run Now hits run #2 (200), then run #3 hits daily rate cap (429 + RATE_LIMITED history)
    const manualRun2 = await fetch(`${baseUrl}/api/schedules/${job.id}/run`, {
      method: "POST",
      headers: { Authorization: headers.Authorization },
    });
    expect(manualRun2.status).toBe(200);
    const manual2Body = (await manualRun2.json()) as { triggered: boolean; runId?: string };
    expect(manual2Body.triggered).toBe(true);
    expect(manual2Body.runId).toBeTruthy();

    await waitFor(() => {
      const r = ctx.repos.runs.getById(manual2Body.runId!);
      return r?.status === "COMPLETED" ? r : null;
    });

    const cappedResp = await fetch(`${baseUrl}/api/schedules/${job.id}/run`, {
      method: "POST",
      headers: { Authorization: headers.Authorization },
    });
    expect(cappedResp.status).toBe(429);
    const cappedBody = (await cappedResp.json()) as { triggered: boolean; reason?: string };
    expect(cappedBody.triggered).toBe(false);
    expect(cappedBody.reason).toContain("Daily schedule cap (2/2)");

    const listResp = await fetch(`${baseUrl}/api/schedules`, {
      headers: { Authorization: headers.Authorization },
    });
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as {
      recentRuns: Array<{ jobId: string; status: string }>;
    };
    expect(listBody.recentRuns.some((r) => r.jobId === job.id && r.status === "RATE_LIMITED")).toBe(
      true,
    );

    // 5. Disable schedule -> next matching minute does not fire -> DELETE removes cleanly
    const patchResp = await fetch(`${baseUrl}/api/schedules/${job.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(patchResp.status).toBe(200);
    const patchBody = (await patchResp.json()) as { job: { enabled: boolean } };
    expect(patchBody.job.enabled).toBe(false);

    const disabledTick = ctx.cronScheduler.tick(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 20, 0)),
    );
    expect(disabledTick).toHaveLength(0);

    const delResp = await fetch(`${baseUrl}/api/schedules/${job.id}`, {
      method: "DELETE",
      headers: { Authorization: headers.Authorization },
    });
    expect(delResp.status).toBe(200);

    const afterDel = (await (
      await fetch(`${baseUrl}/api/schedules`, {
        headers: { Authorization: headers.Authorization },
      })
    ).json()) as { jobs: Array<{ id: string }> };
    expect(afterDel.jobs.some((j) => j.id === job.id)).toBe(false);
  });
});
