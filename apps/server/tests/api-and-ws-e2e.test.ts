import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("REST API, Localhost Auth/Origin Guard, and WebSocket afterSeq Replay E2E", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function bootTestServer(): Promise<{ ctx: OfficeAppContext; baseUrl: string; wsUrl: string }> {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      deltaFlushIntervalMs: 40,
      probeProvidersOnBoot: false,
    });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = ctx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    cleanups.push(async () => {
      await ctx.close();
      tmp.cleanup();
    });

    return {
      ctx,
      baseUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
    };
  }

  it("enforces localhost Host, Origin, and Bearer auth across REST endpoints", async () => {
    const { ctx, baseUrl } = await bootTestServer();

    // Unauthenticated health probe allowed
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);

    // Protected route without token -> 401
    const unauth = await fetch(`${baseUrl}/api/bootstrap`);
    expect(unauth.status).toBe(401);

    // Malicious Origin -> 403
    const evilOrigin = await ctx.app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        host: "127.0.0.1:4310",
        origin: "https://evil-site.example",
        authorization: `Bearer ${ctx.auth.sessionToken}`,
      },
    });
    expect(evilOrigin.statusCode).toBe(403);

    // Malicious Host (DNS rebinding) -> 403
    const evilHost = await ctx.app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        host: "evil.localhost.attacker.com",
        authorization: `Bearer ${ctx.auth.sessionToken}`,
      },
    });
    expect(evilHost.statusCode).toBe(403);

    // Valid request -> 200 with 5 employees
    const ok = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { employees: unknown[] };
    expect(body.employees).toHaveLength(5);
  });

  it("manages projects, tasks, memory search, idempotent approvals, and REST/WS afterSeq replay", async () => {
    const { ctx, baseUrl, wsUrl } = await bootTestServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Register & remove project
    const tempProjectDir = path.join(path.dirname(ctx.companyStore.companyRoot), "sample-proj");
    fs.mkdirSync(tempProjectDir, { recursive: true });
    const createProj = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Sample App", rootPath: tempProjectDir, description: "Demo" }),
    });
    expect(createProj.status).toBe(201);
    const { project } = (await createProj.json()) as { project: { id: string } };

    // 2. Tasks CRUD
    const createTask = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId: project.id, title: "Build MVP", assignedEmployeeId: "senior-engineer" }),
    });
    expect(createTask.status).toBe(201);
    const { task } = (await createTask.json()) as { task: { id: string } };

    const patchTask = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(patchTask.status).toBe(200);

    // 3. Arabic Memory Search (including stringified query limit coercion)
    const memResp = await fetch(
      `${baseUrl}/api/memory/search?q=${encodeURIComponent("تشغيل")}&limit=25`,
      {
        headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
      },
    );
    expect(memResp.status).toBe(200);
    const memJson = (await memResp.json()) as { entries: Array<{ id: string }> };
    expect(memJson.entries.some((e) => e.id === "company-operating-principles")).toBe(true);

    // 4. Enqueue Mock Run & wait for completion
    const runResp = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "general-manager",
        projectId: project.id,
        taskId: task.id,
        prompt: "لخص وضع المشروع",
        mode: "mock",
      }),
    });
    expect(runResp.status).toBe(202);
    const { run } = (await runResp.json()) as { run: { id: string } };

    let status = "QUEUED";
    for (let i = 0; i < 60; i += 1) {
      const check = await fetch(`${baseUrl}/api/runs/${run.id}`, {
        headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
      });
      const data = (await check.json()) as { run: { status: string } };
      status = data.run.status;
      if (status === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(status).toBe("COMPLETED");

    // 4b. Verify GET /api/runs and GET /api/conversations/:id/messages
    const runsListResp = await fetch(`${baseUrl}/api/runs?employeeId=general-manager`, {
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    expect(runsListResp.status).toBe(200);
    const runsListData = (await runsListResp.json()) as { runs: Array<{ id: string; conversationId: string }> };
    expect(runsListData.runs.some((r) => r.id === run.id)).toBe(true);
    const convId = runsListData.runs.find((r) => r.id === run.id)!.conversationId;

    const convMsgsResp = await fetch(`${baseUrl}/api/conversations/${convId}/messages`, {
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    expect(convMsgsResp.status).toBe(200);
    const convMsgsData = (await convMsgsResp.json()) as { messages: Array<{ role: string }> };
    expect(convMsgsData.messages.some((m) => m.role === "user")).toBe(true);
    expect(convMsgsData.messages.some((m) => m.role === "assistant")).toBe(true);

    // 5. REST afterSeq replay
    const allEvResp = await fetch(`${baseUrl}/api/runs/${run.id}/events?afterSeq=0`, {
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    const allEv = (await allEvResp.json()) as { events: Array<{ seq: number }> };
    expect(allEv.events.length).toBeGreaterThanOrEqual(4);
    const firstSeq = allEv.events[0]!.seq;

    // 6. WebSocket afterSeq replay
    const replayed = await new Promise<Array<{ seq: number }>>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(ctx.auth.sessionToken)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket replay timed out"));
      }, 5000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "subscribe", runId: run.id, afterSeq: firstSeq }));
      });
      ws.addEventListener("message", (evt) => {
        const msg = JSON.parse(String(evt.data)) as { kind: string; events?: Array<{ seq: number }> };
        if (msg.kind === "replay") {
          clearTimeout(timer);
          ws.close();
          resolve(msg.events ?? []);
        }
      });
      ws.addEventListener("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    expect(replayed.length).toBe(allEv.events.length - 1);
    expect(replayed.every((e) => e.seq > firstSeq)).toBe(true);

    // 7. Approval Run + Approve + Idempotent 409 conflict on repeat
    const apprRunResp = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "senior-engineer",
        projectId: project.id,
        prompt: "git push changes",
        mode: "mock",
        mockScenario: "approval",
      }),
    });
    const { run: apprRun } = (await apprRunResp.json()) as { run: { id: string } };
    for (let i = 0; i < 60; i += 1) {
      const check = await fetch(`${baseUrl}/api/runs/${apprRun.id}`, {
        headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
      });
      const data = (await check.json()) as { run: { status: string } };
      if (data.run.status === "WAITING_APPROVAL") break;
      await new Promise((r) => setTimeout(r, 30));
    }

    const listAppr = await fetch(`${baseUrl}/api/approvals?status=PENDING`, {
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    const { approvals } = (await listAppr.json()) as { approvals: Array<{ id: string }> };
    expect(approvals).toHaveLength(1);

    const approve1 = await fetch(`${baseUrl}/api/approvals/${approvals[0]!.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED", note: "Ship it" }),
    });
    expect(approve1.status).toBe(200);

    const approve2 = await fetch(`${baseUrl}/api/approvals/${approvals[0]!.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED", note: "Double click" }),
    });
    expect(approve2.status).toBe(409);

    // Cleanup project
    const delProj = await fetch(`${baseUrl}/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ctx.auth.sessionToken}` },
    });
    expect(delProj.status).toBe(200);
  });
});
