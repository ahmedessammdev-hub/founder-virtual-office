import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

async function waitFor<T>(
  check: () => Promise<T | null> | T | null,
  timeoutMs = 15_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await check();
    if (res) return res;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting after ${timeoutMs}ms`);
}

describe("Phase 4 Orchestrator Task DAG & Bounded Meeting Room", () => {
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
      deltaFlushIntervalMs: 30,
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

  it("rejects cyclic DAGs, executes multi-step DAGs respecting dependencies, and cascades upstream failures cleanly", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Cycle rejection -> HTTP 400
    const cyclicResp = await fetch(`${baseUrl}/api/plans`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: "Invalid cyclic test",
        mode: "mock",
        steps: [
          { nodeKey: "a", title: "Step A", assignedEmployeeId: "senior-engineer", dependsOn: ["b"] },
          { nodeKey: "b", title: "Step B", assignedEmployeeId: "product-strategist", dependsOn: ["a"] },
        ],
      }),
    });
    expect(cyclicResp.status).toBe(400);

    // Unknown dependency -> HTTP 400
    const badDepResp = await fetch(`${baseUrl}/api/plans`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: "Unknown dep test",
        mode: "mock",
        steps: [
          { nodeKey: "a", title: "Step A", assignedEmployeeId: "senior-engineer", dependsOn: ["ghost"] },
        ],
      }),
    });
    expect(badDepResp.status).toBe(400);

    // 2. Valid parallel DAG -> step-1 + step-2 run concurrently, then step-3 synthesizes
    const createResp = await fetch(`${baseUrl}/api/plans`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: "Ship multi-tenant billing portal",
        mode: "mock",
        maxConcurrency: 2,
        steps: [
          {
            nodeKey: "step-1",
            title: "Product Spec",
            description: "Draft billing requirements",
            assignedEmployeeId: "product-strategist",
            dependsOn: [],
          },
          {
            nodeKey: "step-2",
            title: "Architecture Plan",
            description: "Design ledger schema",
            assignedEmployeeId: "senior-engineer",
            dependsOn: [],
          },
          {
            nodeKey: "step-3",
            title: "Executive Synthesis",
            description: "Combine spec and architecture",
            assignedEmployeeId: "general-manager",
            dependsOn: ["step-1", "step-2"],
          },
        ],
      }),
    });
    expect(createResp.status).toBe(201);
    const { plan: createdPlan } = (await createResp.json()) as {
      plan: { id: string; rootTaskId: string | null };
    };

    const donePlan = await waitFor(async () => {
      const r = await fetch(`${baseUrl}/api/plans/${createdPlan.id}`, { headers });
      const data = (await r.json()) as {
        plan: {
          status: string;
          synthesisSummary: string | null;
          nodes: Array<{
            nodeKey: string;
            status: string;
            runId: string | null;
            taskId: string | null;
          }>;
        };
      };
      return data.plan.status === "COMPLETED" ? data.plan : null;
    });

    expect(donePlan.nodes).toHaveLength(3);
    expect(donePlan.nodes.every((n) => n.status === "COMPLETED")).toBe(true);
    expect(donePlan.synthesisSummary).toContain("Ship multi-tenant billing portal");

    // Verify step-3 received upstream completed outputs in its prompt
    const step3 = donePlan.nodes.find((n) => n.nodeKey === "step-3")!;
    const step3Run = ctx.repos.runs.getById(step3.runId!);
    expect(step3Run?.prompt).toContain("Upstream Deliverable (step-1:");
    expect(step3Run?.prompt).toContain("Upstream Deliverable (step-2:");

    // Verify linked Kanban tasks all transitioned to `done`
    expect(ctx.repos.tasks.getById(createdPlan.rootTaskId!)?.status).toBe("done");
    for (const node of donePlan.nodes) {
      expect(ctx.repos.tasks.getById(node.taskId!)?.status).toBe("done");
    }

    // 3. Failure cascade test (`loop` mockScenario causes fail-node to abort -> downstream SKIPPED)
    const failCreate = await fetch(`${baseUrl}/api/plans`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: "Test cascade failure handling",
        mode: "mock",
        mockScenario: "loop",
        steps: [
          {
            nodeKey: "upstream-fail",
            title: "Failing Step",
            assignedEmployeeId: "senior-engineer",
            dependsOn: [],
          },
          {
            nodeKey: "downstream-blocked",
            title: "Blocked Downstream",
            assignedEmployeeId: "general-manager",
            dependsOn: ["upstream-fail"],
          },
        ],
      }),
    });
    expect(failCreate.status).toBe(201);
    const { plan: failPlan } = (await failCreate.json()) as { plan: { id: string } };

    const terminalFailed = await waitFor(async () => {
      const p = ctx.repos.plans.getPlanById(failPlan.id);
      return p && p.status === "FAILED" ? p : null;
    });

    expect(terminalFailed.nodes.find((n) => n.nodeKey === "upstream-fail")?.status).toBe("FAILED");
    expect(terminalFailed.nodes.find((n) => n.nodeKey === "downstream-blocked")?.status).toBe(
      "SKIPPED",
    );
  });

  it("enforces bounded meeting rounds (<= 3), records turns cleanly, and auto-creates Kanban Action Items + deliverable", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // Bounded invariant: maxRounds > 3 rejected cleanly with HTTP 400
    const unboundedResp = await fetch(`${baseUrl}/api/meetings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic: "Endless Meeting",
        participantEmployeeIds: ["senior-engineer", "product-strategist"],
        maxRounds: 4,
        mode: "mock",
      }),
    });
    expect(unboundedResp.status).toBe(400);

    // Valid 2-round bounded meeting across 2 specialists
    const startResp = await fetch(`${baseUrl}/api/meetings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic: "Q1 Release Readiness Review",
        agenda: "Confirm test gates and go-live checklist.",
        participantEmployeeIds: ["product-strategist", "senior-engineer"],
        maxRounds: 2,
        mode: "mock",
        autoCreateTasks: true,
      }),
    });
    expect(startResp.status).toBe(201);
    const { meeting: created } = (await startResp.json()) as { meeting: { id: string } };

    const completed = await waitFor(async () => {
      const m = ctx.repos.meetings.getById(created.id);
      return m && m.status === "COMPLETED" ? m : null;
    });

    expect(completed.turns).toHaveLength(4);
    expect(completed.turns.map((t) => t.round)).toEqual([1, 1, 2, 2]);
    expect(completed.decisions).toHaveLength(2);
    expect(completed.actionItems).toHaveLength(2);

    // Verify auto-created Kanban tasks & deliverable minutes file
    for (const item of completed.actionItems) {
      expect(item.taskId).toBeTruthy();
      expect(ctx.repos.tasks.getById(item.taskId!)).toBeTruthy();
    }

    const minutesPath = path.join(
      ctx.companyStore.companyRoot,
      "deliverables",
      "general",
      `${completed.id}.md`,
    );
    expect(fs.existsSync(minutesPath)).toBe(true);
    expect(fs.readFileSync(minutesPath, "utf8")).toContain("Q1 Release Readiness Review");
  });
});
