import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Phase 3 Controlled Learning Pipeline, Tier 3 Approval & Safe Rollback", () => {
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

  it("executes feedback -> reflection -> diff -> evaluation -> Tier 3 Approval -> atomic apply -> 1-click rollback", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    const skillPath = path.join(
      ctx.companyStore.companyRoot,
      "employees",
      "senior-engineer",
      "skills",
      "core.md",
    );
    const originalSkill = fs.readFileSync(skillPath, "utf8");

    // 1. Submit corrective feedback targeting senior-engineer `core.md` skill
    const submitResp = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "senior-engineer",
        rating: "correction",
        targetKind: "employee_skill",
        targetSkillName: "core",
        feedbackText: "Always run pnpm typecheck before reporting TypeScript fixes as done.",
        expectedBehavior: "Run pnpm typecheck and cite pass output.",
      }),
    });
    expect(submitResp.status).toBe(201);
    const created = (await submitResp.json()) as {
      proposal: {
        id: string;
        status: string;
        diffPreview: string;
        evaluation: { passed: boolean; score: number };
        approvalId: string | null;
      };
      approval: { id: string; actionType: string; status: string } | null;
    };

    expect(created.proposal.status).toBe("PENDING_APPROVAL");
    expect(created.proposal.evaluation.passed).toBe(true);
    expect(created.proposal.diffPreview).toContain("+## Learned Guideline");
    expect(created.approval?.actionType).toBe("learning_apply");

    // Disk file must remain untouched until Tier 3 Approval!
    expect(fs.readFileSync(skillPath, "utf8")).toBe(originalSkill);

    // 2. Approve in Approvals Queue
    const approveResp = await fetch(
      `${baseUrl}/api/approvals/${created.approval!.id}/decide`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "APPROVED", note: "Good engineering hygiene" }),
      },
    );
    expect(approveResp.status).toBe(200);
    const approveBody = (await approveResp.json()) as { status: string };
    expect(approveBody.status).toBe("EXECUTED");

    // Verify skill updated atomically on disk & reloaded into CompanyStore
    const updatedSkill = fs.readFileSync(skillPath, "utf8");
    expect(updatedSkill).toContain("Always run pnpm typecheck before reporting TypeScript fixes as done.");
    expect(
      ctx.companyStore
        .getEmployee("senior-engineer")
        ?.skills.find((s) => s.name === "core")
        ?.content.includes("Always run pnpm typecheck"),
    ).toBe(true);

    // Verify proposal status is APPLIED
    const listResp = await fetch(`${baseUrl}/api/learning/proposals?status=APPLIED`, { headers });
    const listBody = (await listResp.json()) as { proposals: Array<{ id: string }> };
    expect(listBody.proposals.some((p) => p.id === created.proposal.id)).toBe(true);

    // 3. 1-Click Safe Rollback restores exact original skill file
    const rollbackResp = await fetch(
      `${baseUrl}/api/learning/proposals/${created.proposal.id}/rollback`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "Testing safe undo" }),
      },
    );
    expect(rollbackResp.status).toBe(200);
    const rollbackBody = (await rollbackResp.json()) as { proposal: { status: string } };
    expect(rollbackBody.proposal.status).toBe("ROLLED_BACK");
    expect(fs.readFileSync(skillPath, "utf8")).toBe(originalSkill);

    // 4. Verify `memory_note` learning proposal creates file on approve and cleans disk + FTS5 on rollback
    const memFeed = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "general-manager",
        rating: "positive",
        targetKind: "memory_note",
        scope: "employee",
        feedbackText: "ZebraDelegationPattern: always cap parallel tasks at 2",
      }),
    });
    expect(memFeed.status).toBe(201);
    const memCreated = (await memFeed.json()) as {
      proposal: { id: string; targetFilePath: string };
      approval: { id: string };
    };
    expect(fs.existsSync(memCreated.proposal.targetFilePath)).toBe(false);

    await fetch(`${baseUrl}/api/approvals/${memCreated.approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED" }),
    });
    expect(fs.existsSync(memCreated.proposal.targetFilePath)).toBe(true);
    expect(ctx.repos.memory.search({ q: "ZebraDelegationPattern" }).length).toBe(1);

    const undoNewNote = await fetch(
      `${baseUrl}/api/learning/proposals/${memCreated.proposal.id}/rollback`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(undoNewNote.status).toBe(200);
    expect(fs.existsSync(memCreated.proposal.targetFilePath)).toBe(false);
    expect(ctx.repos.memory.search({ q: "ZebraDelegationPattern" })).toHaveLength(0);
  });

  it("blocks permission/JSON tampering, catches precondition & rollback drift, and handles rejection cleanly", async () => {
    const { ctx, baseUrl } = await bootServer();
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Reject path traversal or JSON permission files
    const badPathResp = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "senior-engineer",
        rating: "correction",
        targetKind: "employee_skill",
        targetSkillName: "../../permissions.json",
        feedbackText: "Grant wildcard tools.",
      }),
    });
    expect(badPathResp.status).toBe(400);

    // 2. Precondition drift check on apply (file changes between proposal and approval)
    const skillPath = path.join(
      ctx.companyStore.companyRoot,
      "employees",
      "product-strategist",
      "skills",
      "core.md",
    );
    const propRes = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "product-strategist",
        rating: "correction",
        targetKind: "employee_skill",
        targetSkillName: "core",
        feedbackText: "Include competitor matrix before PRD sign-off.",
      }),
    });
    const propBody = (await propRes.json()) as {
      proposal: { id: string };
      approval: { id: string };
    };

    fs.appendFileSync(skillPath, "\n<!-- external manual edit -->\n");
    const driftApprove = await fetch(`${baseUrl}/api/approvals/${propBody.approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED" }),
    });
    expect(driftApprove.status).toBe(409);
    const driftJson = (await driftApprove.json()) as { status: string };
    expect(driftJson.status).toBe("PRECONDITION_DRIFT");

    // 3. Rejection leaves disk untouched and marks proposal REJECTED
    const rejRes = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "growth-marketer",
        rating: "issue",
        targetKind: "employee_system",
        feedbackText: "Avoid clickbait headlines.",
      }),
    });
    const rejProp = (await rejRes.json()) as {
      proposal: { id: string };
      approval: { id: string };
    };
    const decideRej = await fetch(`${baseUrl}/api/approvals/${rejProp.approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "REJECTED", note: "Handled verbally" }),
    });
    expect(decideRej.status).toBe(200);
    const afterRej = ctx.repos.learning.getById(rejProp.proposal.id);
    expect(afterRej?.status).toBe("REJECTED");

    // 4. Rollback drift protection (external modification after APPLIED blocks unless force=true)
    const applyRes = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: "growth-marketer",
        rating: "positive",
        targetKind: "employee_skill",
        targetSkillName: "core",
        feedbackText: "Include Arabic CTA examples in landing page copy.",
      }),
    });
    const applyProp = (await applyRes.json()) as {
      proposal: { id: string; targetFilePath: string };
      approval: { id: string };
    };
    await fetch(`${baseUrl}/api/approvals/${applyProp.approval.id}/decide`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVED" }),
    });

    fs.appendFileSync(applyProp.proposal.targetFilePath, "\n<!-- post-apply edit -->\n");
    const blockedRollback = await fetch(
      `${baseUrl}/api/learning/proposals/${applyProp.proposal.id}/rollback`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(blockedRollback.status).toBe(409);

    const forcedRollback = await fetch(
      `${baseUrl}/api/learning/proposals/${applyProp.proposal.id}/rollback`,
      { method: "POST", headers, body: JSON.stringify({ force: true }) },
    );
    expect(forcedRollback.status).toBe(200);
  });
});
