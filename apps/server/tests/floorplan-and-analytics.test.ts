import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Phase 6 Floorplan Builder, Analytics Dashboard, CSV Audit & Standalone SPA", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function bootServer(opts?: {
    webDistDir?: string;
  }): Promise<{ ctx: OfficeAppContext; baseUrl: string }> {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      enableAutomationPollers: false,
      probeProvidersOnBoot: false,
      webDistDir: opts?.webDistDir,
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

  it("updates floorplan theme, desk coordinates, zones, and departments atomically while rejecting overlaps & out-of-bounds", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    const bootResp = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: headers.Authorization },
    });
    expect(bootResp.status).toBe(200);
    const boot = (await bootResp.json()) as {
      company: {
        departments: Array<{ id: string; name: string; nameAr: string; color: string }>;
        floorplan: {
          width: number;
          height: number;
          zones: Array<{
            id: string;
            name: string;
            nameAr: string;
            kind: "workstations" | "meeting_room" | "manager_office" | "lounge";
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
          desks: Array<{ id: string; zoneId: string; x: number; y: number; employeeId?: string }>;
        };
      };
    };

    // Valid update: drag desk-eng with 90° rotation, apply warm_sand theme, add war-room zone & ops department
    const movedDesks = boot.company.floorplan.desks.map((d) =>
      d.id === "desk-eng" ? { ...d, x: 800, y: 150, rotationDeg: 90 as const } : d,
    );
    const updateResp = await fetch(`${baseUrl}/api/company/floorplan`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        width: 1200,
        height: 760,
        theme: "warm_sand",
        departments: [
          ...boot.company.departments,
          { id: "ops", name: "Operations", nameAr: "العمليات", color: "#0D9488" },
        ],
        zones: [
          ...boot.company.floorplan.zones,
          {
            id: "war-room",
            name: "War Room",
            nameAr: "غرفة العمليات",
            kind: "meeting_room",
            x: 880,
            y: 500,
            width: 260,
            height: 180,
          },
        ],
        desks: movedDesks,
      }),
    });
    expect(updateResp.status).toBe(200);

    const diskCfg = JSON.parse(
      fs.readFileSync(path.join(ctx.companyStore.companyRoot, "company.json"), "utf8"),
    ) as {
      departments: Array<{ id: string }>;
      floorplan: {
        theme?: string;
        desks: Array<{ id: string; x: number; y: number; rotationDeg?: number }>;
        zones: Array<{ id: string }>;
      };
    };
    expect(diskCfg.floorplan.theme).toBe("warm_sand");
    expect(diskCfg.floorplan.desks.find((d) => d.id === "desk-eng")).toMatchObject({
      x: 800,
      y: 150,
      rotationDeg: 90,
    });
    expect(diskCfg.floorplan.zones.some((z) => z.id === "war-room")).toBe(true);
    expect(diskCfg.departments.some((d) => d.id === "ops")).toBe(true);

    // Reject invalid rotation angle (45°) with 400
    const badRotDesks = movedDesks.map((d) =>
      d.id === "desk-eng" ? { ...d, rotationDeg: 45 } : d,
    );
    const badRotResp = await fetch(`${baseUrl}/api/company/floorplan`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ desks: badRotDesks }),
    });
    expect(badRotResp.status).toBe(400);

    // Reject overlapping desks with 400
    const collidingDesks = movedDesks.map((d) =>
      d.id === "desk-eng" ? { ...d, x: 520, y: 140 } : d,
    );
    const overlapResp = await fetch(`${baseUrl}/api/company/floorplan`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ desks: collidingDesks }),
    });
    expect(overlapResp.status).toBe(400);

    // Reject out-of-bounds desk with 400
    const oobDesks = movedDesks.map((d) => (d.id === "desk-eng" ? { ...d, x: 1100, y: 700 } : d));
    const oobResp = await fetch(`${baseUrl}/api/company/floorplan`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ desks: oobDesks }),
    });
    expect(oobResp.status).toBe(400);
  });

  it("aggregates analytics isolating live vs mock spend and filters/exports formula-safe CSV audit logs", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = { Authorization: `Bearer ${ctx.auth.sessionToken}` };

    const conv = ctx.repos.conversations.create({
      employeeId: "senior-engineer",
      title: "Phase 6 Analytics Seed",
    });

    const liveRun = ctx.repos.runs.create({
      conversationId: conv.id,
      employeeId: "senior-engineer",
      mode: "live",
      status: "QUEUED",
      runtimeProvider: "codex",
      model: "gpt-5.4",
      riskTier: "tier1_auto",
      prompt: "Analyze codebase health",
      configSnapshot: {},
    });
    ctx.repos.runs.markStarted(liveRun.id, "RUNNING");
    ctx.repos.runs.updateStatus(liveRun.id, "COMPLETED", { finalOutput: "OK", finished: true });

    const mockRun = ctx.repos.runs.create({
      conversationId: conv.id,
      employeeId: "general-manager",
      mode: "mock",
      status: "QUEUED",
      runtimeProvider: "mock",
      model: "mock-v1",
      riskTier: "tier1_auto",
      prompt: "Simulated check",
      configSnapshot: {},
    });
    ctx.repos.runs.markStarted(mockRun.id, "RUNNING");
    ctx.repos.runs.updateStatus(mockRun.id, "COMPLETED", { finalOutput: "Mock OK", finished: true });

    ctx.repos.usage.record({
      runId: liveRun.id,
      employeeId: "senior-engineer",
      projectId: null,
      provider: "codex",
      model: "gpt-5.4",
      mode: "live",
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.042,
    });
    ctx.repos.usage.record({
      runId: mockRun.id,
      employeeId: "general-manager",
      projectId: null,
      provider: "mock",
      model: "mock-v1",
      mode: "mock",
      inputTokens: 500,
      outputTokens: 100,
      costUsd: 0.999,
    });

    ctx.repos.audit.log({
      actorType: "human",
      actorId: "founder",
      action: "spreadsheet.test",
      targetType: "formula",
      targetId: "=SUM(A1:A10)",
      status: "OK",
      details: { note: "Comma, quote \"test\"" },
    });
    ctx.repos.audit.log({
      actorType: "system",
      actorId: "policy-guard",
      action: "policy.denied",
      targetType: "tool",
      targetId: "send_email",
      status: "DENIED",
    });

    const analyticsResp = await fetch(`${baseUrl}/api/analytics?days=14`, { headers });
    expect(analyticsResp.status).toBe(200);
    const { analytics } = (await analyticsResp.json()) as {
      analytics: {
        daysWindow: number;
        totals: {
          totalRuns: number;
          completedRuns: number;
          liveTotalUsd: number;
          mockTotalUsd: number;
          totalInputTokens: number;
          deniedAuditEvents: number;
        };
        dailySeries: Array<{ day: string; runsCount: number; liveCostUsd: number }>;
        byEmployee: Array<{ employeeId: string; runsCount: number; liveCostUsd: number }>;
        securitySignals: Array<{ action: string; status: string; count: number }>;
        baselineDelta?: {
          previousRuns: number;
          runsDeltaPct: number;
          previousLiveUsd: number;
          liveUsdDeltaPct: number;
          previousSuccessRatePct: number;
          successRateDeltaPts: number;
        };
      };
    };

    expect(analytics.daysWindow).toBe(14);
    expect(analytics.baselineDelta).toMatchObject({
      previousRuns: 0,
      runsDeltaPct: 100,
      previousLiveUsd: 0,
      liveUsdDeltaPct: 100,
    });
    expect(analytics.totals.totalRuns).toBe(2);
    expect(analytics.totals.completedRuns).toBe(2);
    expect(analytics.totals.liveTotalUsd).toBeCloseTo(0.042, 6);
    expect(analytics.totals.mockTotalUsd).toBeCloseTo(0.999, 6);
    expect(analytics.totals.totalInputTokens).toBe(1700);
    expect(analytics.totals.deniedAuditEvents).toBeGreaterThanOrEqual(1);
    expect(analytics.dailySeries).toHaveLength(14);
    expect(analytics.dailySeries[0]!.day <= analytics.dailySeries[13]!.day).toBe(true);
    expect(
      analytics.byEmployee.find((e) => e.employeeId === "senior-engineer"),
    ).toMatchObject({ runsCount: 1, liveCostUsd: 0.042 });
    expect(
      analytics.securitySignals.some((s) => s.action === "policy.denied" && s.status === "DENIED"),
    ).toBe(true);

    // Filtered audit query
    const filteredResp = await fetch(
      `${baseUrl}/api/audit?actorType=system&status=DENIED&q=policy`,
      { headers },
    );
    expect(filteredResp.status).toBe(200);
    const filteredBody = (await filteredResp.json()) as {
      logs: Array<{ action: string; status: string }>;
    };
    expect(filteredBody.logs).toHaveLength(1);
    expect(filteredBody.logs[0]!.action).toBe("policy.denied");

    // CSV export + formula injection neutralization
    const csvResp = await fetch(`${baseUrl}/api/audit?format=csv`, { headers });
    expect(csvResp.status).toBe(200);
    expect(csvResp.headers.get("content-type")).toContain("text/csv");
    const csvText = await csvResp.text();
    expect(csvText).toContain("'=SUM(A1:A10)");
    expect(csvText).toContain('"{""note"":""Comma, quote \\""test\\""""}"');
  });

  it("serves standalone built SPA securely with traversal blocking and cross-site session guard", async () => {
    const tmpBase = createTempOfficeDirs();
    const webDistDir = path.join(tmpBase.baseDir, "web-dist");
    fs.mkdirSync(path.join(webDistDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(webDistDir, "index.html"),
      "<!doctype html><html><body>Virtual Office SPA</body></html>",
      "utf8",
    );
    fs.writeFileSync(path.join(webDistDir, "assets", "app.js"), "console.log('ok');", "utf8");
    fs.writeFileSync(path.join(tmpBase.baseDir, "secret.txt"), "TOP_SECRET", "utf8");
    cleanups.push(() => tmpBase.cleanup());

    const { ctx, baseUrl } = await bootServer({ webDistDir });

    const rootResp = await fetch(`${baseUrl}/`);
    expect(rootResp.status).toBe(200);
    expect(await rootResp.text()).toContain("Virtual Office SPA");

    const spaRouteResp = await fetch(`${baseUrl}/analytics`);
    expect(spaRouteResp.status).toBe(200);
    expect(await spaRouteResp.text()).toContain("Virtual Office SPA");

    const assetResp = await fetch(`${baseUrl}/assets/app.js`);
    expect(assetResp.status).toBe(200);
    expect(await assetResp.text()).toContain("console.log('ok')");

    const missingAssetResp = await fetch(`${baseUrl}/assets/missing.js`);
    expect(missingAssetResp.status).toBe(404);

    // Traversal blocked on both raw TCP encoded request & direct inject (and normalized fetch never reads parent file)
    const normalizedResp = await fetch(`${baseUrl}/%2e%2e/secret.txt`);
    expect([403, 404]).toContain(normalizedResp.status);
    expect(await normalizedResp.text()).not.toContain("TOP_SECRET");

    const rawTcpStatus = await new Promise<number>((resolve, reject) => {
      const parsedBase = new URL(baseUrl);
      const req = http.request(
        {
          hostname: parsedBase.hostname,
          port: Number(parsedBase.port),
          path: "/%2e%2e/secret.txt",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(rawTcpStatus).toBe(403);

    const rawDotDotTcpStatus = await new Promise<number>((resolve, reject) => {
      const parsedBase = new URL(baseUrl);
      const req = http.request(
        {
          hostname: parsedBase.hostname,
          port: Number(parsedBase.port),
          path: "/../secret.txt",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(rawDotDotTcpStatus).toBe(403);

    const normalizedInject = await ctx.app.inject({
      method: "GET",
      url: "/../secret.txt",
      headers: { host: "127.0.0.1" },
    });
    expect([403, 404]).toContain(normalizedInject.statusCode);
    expect(normalizedInject.body).not.toContain("TOP_SECRET");

    // /__office_session rejects cross-site browser requests & allows localhost same-origin
    const crossSiteResp = await fetch(`${baseUrl}/__office_session`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSiteResp.status).toBe(403);

    const okSessionResp = await fetch(`${baseUrl}/__office_session`);
    expect(okSessionResp.status).toBe(200);
    const sessionJson = (await okSessionResp.json()) as { token: string };
    expect(sessionJson.token).toBe(ctx.auth.sessionToken);
  });

  it("validates Phase 8 avatarModelUrl schema & serves company-assets/avatars safely with traversal blocked", async () => {
    const { EmployeeProfileSchema } = await import("@virtual-office/shared");
    expect(
      EmployeeProfileSchema.safeParse({
        id: "emp-3d",
        name: "Maya",
        nameAr: "مايا",
        role: "Engineer",
        roleAr: "مهندسة",
        department: "engineering",
        avatar: "M",
        avatarModelUrl: "/assets/avatars/sample-rigged.glb",
        avatarTone: "#16B88B",
        deskId: "desk-1",
        runtime: { provider: "mock", model: "mock-1" },
      }).success,
    ).toBe(true);

    expect(
      EmployeeProfileSchema.safeParse({
        id: "emp-bad",
        name: "Bad",
        nameAr: "سيء",
        role: "Engineer",
        roleAr: "مهندس",
        department: "engineering",
        avatar: "B",
        avatarModelUrl: "https://evil.example.com/model.glb",
        deskId: "desk-1",
        runtime: { provider: "mock", model: "mock-1" },
      }).success,
    ).toBe(false);

    const { ctx, baseUrl } = await bootServer();
    const avatarDir = path.join(ctx.companyStore.companyRoot, "assets", "avatars");
    fs.mkdirSync(avatarDir, { recursive: true });
    fs.writeFileSync(path.join(avatarDir, "custom-hero.glb"), Buffer.from("glTF_TEST_GLB"));

    const okGlb = await fetch(`${baseUrl}/company-assets/avatars/custom-hero.glb`);
    expect(okGlb.status).toBe(200);
    expect(okGlb.headers.get("content-type")).toContain("model/gltf-binary");

    const missingGlb = await fetch(`${baseUrl}/company-assets/avatars/missing.glb`);
    expect(missingGlb.status).toBe(404);

    const traversalStatus = await new Promise<number>((resolve, reject) => {
      const parsedBase = new URL(baseUrl);
      const req = http.request(
        {
          hostname: parsedBase.hostname,
          port: Number(parsedBase.port),
          path: "/company-assets/avatars/%2e%2e%2fsecret.glb",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(traversalStatus).toBe(400);
  });
});
