import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/company/atomic-fs.js";
import { CompanyStore } from "../src/company/company-store.js";
import { OfficeDatabase } from "../src/db/database.js";
import { ApprovalsRepository } from "../src/db/repositories/approvals-repo.js";
import { AuditRepository } from "../src/db/repositories/audit-repo.js";
import { ApprovalEngine } from "../src/governance/approval-engine.js";
import { PolicyGuard } from "../src/governance/policy-guard.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("3-Tier Policy Guard, Live Revocation, and Idempotent Approval Engine", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("enforces 3-tier policy rules and respects live permission revocations immediately", () => {
    const tmp = createTempOfficeDirs();
    const store = new CompanyStore(tmp.companyRoot);
    cleanups.push(() => tmp.cleanup());

    const guard = new PolicyGuard(store);

    // Tier 1 tool allowed
    expect(guard.evaluate({ employeeId: "senior-engineer", toolName: "read_file" }).outcome).toBe(
      "allow",
    );

    // Tier 3 tool requires approval
    expect(guard.evaluate({ employeeId: "senior-engineer", toolName: "git_push" }).outcome).toBe(
      "require_approval",
    );

    // Denied tool rejected
    expect(guard.evaluate({ employeeId: "senior-engineer", toolName: "send_email" }).outcome).toBe(
      "deny",
    );

    // .env file triggers Tier 3 approval requirement
    const projDir = path.join(tmp.baseDir, "repo");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, ".env"), "API_KEY=secret123456", "utf8");
    const project = store.registerProject({ name: "Demo Repo", rootPath: projDir });

    const envCheck = guard.evaluate({
      employeeId: "senior-engineer",
      toolName: "read_file",
      projectId: project.id,
      targetPath: path.join(projDir, ".env"),
    });
    expect(envCheck.outcome).toBe("require_approval");

    // Live permission revocation on disk -> reload -> immediately denied
    const permsPath = path.join(tmp.companyRoot, "employees", "senior-engineer", "permissions.json");
    const perms = JSON.parse(fs.readFileSync(permsPath, "utf8")) as {
      allowedTools: string[];
      deniedTools: string[];
    };
    perms.deniedTools.push("read_file");
    atomicWriteFile(permsPath, JSON.stringify(perms, null, 2));
    store.reloadAll();

    expect(guard.evaluate({ employeeId: "senior-engineer", toolName: "read_file" }).outcome).toBe(
      "deny",
    );
  });

  it("prevents double-execution on concurrent Approve calls and checks TTL + precondition drift", async () => {
    const tmp = createTempOfficeDirs();
    const db = new OfficeDatabase(":memory:");
    const store = new CompanyStore(tmp.companyRoot);
    cleanups.push(() => {
      db.close();
      tmp.cleanup();
    });

    const approvalsRepo = new ApprovalsRepository(db.db);
    const auditRepo = new AuditRepository(db.db);
    const engine = new ApprovalEngine(approvalsRepo, auditRepo, store);

    // 1. Concurrent Double-Approve protection
    const approval = engine.createApproval({
      employeeId: "senior-engineer",
      actionType: "git_push",
      title: "Push branch",
      summary: "Push verified commits",
      payload: { branch: "vo/test" },
      taintedByExternalInput: true,
    });
    expect(approval.taintedByExternalInput).toBe(true);

    let executionCount = 0;
    const executor = async (): Promise<Record<string, unknown>> => {
      executionCount += 1;
      return { pushed: true, count: executionCount };
    };

    const [resA, resB] = await Promise.all([
      engine.decide(approval.id, { decision: "APPROVED", note: "click 1" }, executor),
      engine.decide(approval.id, { decision: "APPROVED", note: "click 2" }, executor),
    ]);

    expect(executionCount).toBe(1);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual(["ALREADY_DECIDED", "EXECUTED"]);

    // 2. TTL Expiration
    const expiredApproval = engine.createApproval({
      employeeId: "growth-marketer",
      actionType: "send_email",
      title: "Expired action",
      summary: "Old request",
      payload: { to: "x@example.com" },
      ttlMs: -5_000,
    });
    const expiredRes = await engine.decide(expiredApproval.id, { decision: "APPROVED" }, executor);
    expect(expiredRes.status).toBe("EXPIRED");
    expect(executionCount).toBe(1);

    // 3. Precondition Drift Detection
    const targetFile = path.join(tmp.baseDir, "contract.txt");
    fs.writeFileSync(targetFile, "v1 content", "utf8");
    const driftApproval = engine.createApproval({
      employeeId: "general-manager",
      actionType: "delete_file",
      title: "Modify contract",
      summary: "Targets v1",
      payload: { file: targetFile },
      targetFilePath: targetFile,
    });

    // Mutate file before approval decision
    fs.writeFileSync(targetFile, "v2 modified by someone else", "utf8");
    const driftRes = await engine.decide(driftApproval.id, { decision: "APPROVED" }, executor);
    expect(driftRes.status).toBe("PRECONDITION_DRIFT");
    expect(executionCount).toBe(1);
  });
});
