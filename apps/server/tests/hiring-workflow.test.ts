import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Phase 4 HR Hiring Workflow, Floorplan Desk Allocation & Safe Rollback", () => {
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

  it("proposes hire -> enforces Tier 3 Approval -> provisions employee folder + non-overlapping desk + FTS5 -> rolls back cleanly", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Fetch curated templates
    const tplResp = await fetch(`${baseUrl}/api/hiring/templates`, { headers });
    expect(tplResp.status).toBe(200);
    const { templates } = (await tplResp.json()) as {
      templates: Array<{ id: string; defaults: Record<string, unknown> }>;
    };
    const qaTemplate = templates.find((t) => t.id === "qa-engineer");
    expect(qaTemplate).toBeTruthy();

    // 2. Submit hiring proposal
    const createResp = await fetch(`${baseUrl}/api/hiring/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(qaTemplate!.defaults),
    });
    expect(createResp.status).toBe(201);
    const { proposal, approval } = (await createResp.json()) as {
      proposal: {
        id: string;
        employeeId: string;
        status: string;
        proposedDesk: { id: string; x: number; y: number };
        diffPreview: string;
      };
      approval: { id: string; actionType: string; status: string };
    };

    expect(proposal.employeeId).toBe("qa-engineer");
    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.proposedDesk).toEqual({
      id: "desk-qa-engineer",
      zoneId: "workstations",
      x: 1020,
      y: 130,
      employeeId: "qa-engineer",
    });
    expect(approval.actionType).toBe("hire_employee");

    // Must NOT touch disk before Founder Tier 3 Approval!
    const qaDir = path.join(ctx.companyStore.companyRoot, "employees", "qa-engineer");
    expect(fs.existsSync(qaDir)).toBe(false);

    // 3. Approve via Approvals Queue
    const decideResp = await fetch(`${baseUrl}/api/approvals/${approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED", note: "Welcome Tariq" }),
    });
    expect(decideResp.status).toBe(200);
    const decideBody = (await decideResp.json()) as { status: string };
    expect(decideBody.status).toBe("EXECUTED");

    // Verify all 5 files provisioned on disk + desk added to company.json
    expect(fs.existsSync(path.join(qaDir, "profile.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(qaDir, "system.md"))).toBe(true);
    expect(fs.existsSync(path.join(qaDir, "permissions.json"))).toBe(true);
    expect(fs.existsSync(path.join(qaDir, "skills", "core.md"))).toBe(true);
    expect(fs.existsSync(path.join(qaDir, "memory", "notes.md"))).toBe(true);

    const empList = (await (await fetch(`${baseUrl}/api/employees`, { headers })).json()) as {
      employees: Array<{ profile: { id: string } }>;
    };
    expect(empList.employees).toHaveLength(6);
    expect(empList.employees.some((e) => e.profile.id === "qa-engineer")).toBe(true);

    const bootBody = (await (await fetch(`${baseUrl}/api/bootstrap`, { headers })).json()) as {
      company: { floorplan: { width: number; desks: Array<{ id: string }> } };
    };
    expect(bootBody.company.floorplan.desks.some((d) => d.id === "desk-qa-engineer")).toBe(true);
    expect(bootBody.company.floorplan.width).toBeGreaterThanOrEqual(1300);

    // Verify new employee onboarding memory was automatically indexed in FTS5
    const memResp = (await (
      await fetch(`${baseUrl}/api/memory/search?q=Tariq`, { headers })
    ).json()) as { entries: Array<{ id: string }> };
    expect(memResp.entries.some((m) => m.id === "qa-engineer-charter")).toBe(true);

    // 4. Rollback hire restores 5-employee office & removes folder/desk/index cleanly
    const rollbackResp = await fetch(
      `${baseUrl}/api/hiring/proposals/${proposal.id}/rollback`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "Role deferred to next quarter" }),
      },
    );
    expect(rollbackResp.status).toBe(200);
    const rbBody = (await rollbackResp.json()) as { proposal: { status: string } };
    expect(rbBody.proposal.status).toBe("ROLLED_BACK");

    expect(fs.existsSync(qaDir)).toBe(false);
    expect(ctx.companyStore.listEmployees()).toHaveLength(5);
    expect(
      ctx.companyStore
        .getCompanyConfig()
        .floorplan.desks.some((d) => d.employeeId === "qa-engineer"),
    ).toBe(false);
    expect(ctx.companyStore.getCompanyConfig().floorplan.width).toBe(1200);
    expect(ctx.repos.memory.search({ q: "Tariq" })).toHaveLength(0);
  });

  it("blocks duplicate or path-traversal IDs and handles hiring rejection without disk changes", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    const basePayload = {
      name: "Test",
      nameAr: "تجربة",
      role: "Test Engineer",
      roleAr: "مهندس اختبار",
      avatar: "TE",
      justification: "Testing boundaries",
      systemPrompt: "You are a test engineer verifying security limits cleanly.",
      coreSkillContent: "- Follow security boundary rules.",
    };

    // Duplicate ID -> 400
    const dupResp = await fetch(`${baseUrl}/api/hiring/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...basePayload, employeeId: "senior-engineer" }),
    });
    expect(dupResp.status).toBe(400);

    // Path traversal -> 400
    const traversalResp = await fetch(`${baseUrl}/api/hiring/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...basePayload, employeeId: "../../evil" }),
    });
    expect(traversalResp.status).toBe(400);

    // Rejection -> proposal marked REJECTED, company untouched
    const rejCreate = await fetch(`${baseUrl}/api/hiring/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...basePayload, employeeId: "temp-analyst" }),
    });
    expect(rejCreate.status).toBe(201);
    const { proposal, approval } = (await rejCreate.json()) as {
      proposal: { id: string };
      approval: { id: string };
    };

    const rejectResp = await fetch(`${baseUrl}/api/approvals/${approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "REJECTED", note: "Not hiring right now" }),
    });
    expect(rejectResp.status).toBe(200);
    expect(ctx.repos.hiring.getById(proposal.id)?.status).toBe("REJECTED");
    expect(
      fs.existsSync(path.join(ctx.companyStore.companyRoot, "employees", "temp-analyst")),
    ).toBe(false);
    expect(ctx.companyStore.listEmployees()).toHaveLength(5);
  });
});
