import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer } from "../src/api/server.js";
import { StaticMasterKeyProvider } from "../src/governance/vault.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Internal office-mcp Bridge & External McpManager Governance", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("enforces run-scoped token auth, memory isolation, deliverable containment, and approval tainting on POST /mcp", async () => {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      probeProvidersOnBoot: false,
      vaultKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
    });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = ctx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const mcpUrl = `http://127.0.0.1:${port}/mcp`;

    cleanups.push(async () => {
      await ctx.close();
      tmp.cleanup();
    });

    // 1. Missing or founder session token must be rejected on /mcp (Run-Scoped Token ONLY)
    const unauth = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(unauth.status).toBe(401);

    const founderTokRejected = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.auth.sessionToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(founderTokRejected.status).toBe(401);

    // 2. Mint run-scoped token for a real run containing untrusted external input context
    const conv = ctx.repos.conversations.create({ employeeId: "senior-engineer", title: "MCP Test" });
    const run = ctx.repos.runs.create({
      conversationId: conv.id,
      employeeId: "senior-engineer",
      projectId: null,
      mode: "live",
      status: "RUNNING",
      runtimeProvider: "codex",
      model: "gpt-5.6-luna",
      riskTier: "tier1_auto",
      prompt: "test",
      configSnapshot: {},
    });
    ctx.repos.runs.appendRunEvent(run.id, 1, {
      type: "context_assembled",
      tokenEstimate: 100,
      injectedMemoryIds: [],
      hasUntrustedExternalInput: true,
      slices: { identity: 50 },
    });

    const runToken = ctx.auth.mintRunToken({
      runId: run.id,
      employeeId: "senior-engineer",
      projectId: null,
    });

    // tools/list
    const listResp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(listResp.status).toBe(200);
    const listJson = (await listResp.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listJson.result.tools.map((t) => t.name)).toContain("office_request_approval");

    // office_search_memory must return senior-engineer/company notes, NEVER general-manager notes
    const memResp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "office_search_memory", arguments: { q: "سقف التوازي" } },
      }),
    });
    const memJson = (await memResp.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const memParsed = JSON.parse(memJson.result.content[0]!.text) as {
      entries: Array<{ id: string }>;
    };
    expect(memParsed.entries.some((e) => e.id === "gm-initial-charter")).toBe(false);

    // office_write_deliverable blocks path traversal and writes safely inside company/deliverables
    const traversalResp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "office_write_deliverable",
          arguments: { fileName: "../../evil.txt", content: "bad" },
        },
      }),
    });
    const travJson = (await traversalResp.json()) as { result: { isError: boolean } };
    expect(travJson.result.isError).toBe(true);

    const writeResp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "office_write_deliverable",
          arguments: { fileName: "architecture-summary.md", content: "# Summary\nReady." },
        },
      }),
    });
    const writeJson = (await writeResp.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(writeJson.result.isError).toBe(false);
    expect(
      fs.existsSync(path.join(tmp.companyRoot, "deliverables", "general", "architecture-summary.md")),
    ).toBe(true);

    // office_request_approval creates a PENDING tainted approval & pauses run in WAITING_APPROVAL
    const apprResp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "office_request_approval",
          arguments: {
            actionType: "git_push",
            title: "Push via MCP",
            summary: "Ready to push",
            payload: { branch: "main" },
          },
        },
      }),
    });
    const apprJson = (await apprResp.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const apprParsed = JSON.parse(apprJson.result.content[0]!.text) as {
      status: string;
      approvalId: string;
    };
    expect(apprParsed.status).toBe("PENDING_APPROVAL");
    expect(ctx.repos.runs.getById(run.id)?.status).toBe("WAITING_APPROVAL");
    expect(ctx.repos.approvals.getById(apprParsed.approvalId)?.taintedByExternalInput).toBe(true);
  });

  it("connects to an external stdio MCP server, discovers tools, and enforces PolicyGuard + employee ACLs", async () => {
    const tmp = createTempOfficeDirs();
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "vo-mcp-srv-"));
    const mockMcpScript = path.join(scriptDir, "tiny-mcp.mjs");

    fs.writeFileSync(
      mockMcpScript,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "tiny", version: "1.0" } } }) + "\\n");
  } else if (req.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "echo", description: "Echo input" }, { name: "deploy_prod", description: "Deploy" }] } }) + "\\n");
  } else if (req.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "ECHO:" + JSON.stringify(req.params.arguments) + "|SECRET=" + (process.env.DEMO_MCP_SECRET || "none") }] } }) + "\\n");
  }
});
`,
      "utf8",
    );

    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      probeProvidersOnBoot: false,
      vaultKeyProvider: new StaticMasterKeyProvider(crypto.randomBytes(32)),
    });

    cleanups.push(async () => {
      await ctx.close();
      tmp.cleanup();
      fs.rmSync(scriptDir, { recursive: true, force: true });
    });

    ctx.vault.setSecret("DEMO_MCP_SECRET", "top_secret_val_99");
    ctx.mcpManager.upsertServer({
      id: "tiny",
      name: "Tiny Test MCP",
      transport: "stdio",
      command: process.execPath,
      args: [mockMcpScript],
      envVaultKeys: ["DEMO_MCP_SECRET"],
      enabled: true,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: ["senior-engineer"],
      toolRiskOverrides: { deploy_prod: "tier3_approval" },
    });

    // Test connection & tools discovery
    const testRes = await ctx.mcpManager.testServer("tiny");
    expect(testRes.ok).toBe(true);
    expect(testRes.tools.map((t) => t.name)).toEqual(["echo", "deploy_prod"]);

    // ACL check: hr-talent is NOT in allowedEmployeeIds
    const deniedEmp = await ctx.mcpManager.callTool({
      serverId: "tiny",
      toolName: "echo",
      args: { hello: "world" },
      employeeId: "hr-talent",
      runId: "r-acl",
    });
    expect(deniedEmp.outcome).toBe("denied");

    // Grant `mcp:tiny:echo` in senior-engineer permissions copy and verify execution + vaulted env injection
    const engPermsPath = path.join(tmp.companyRoot, "employees", "senior-engineer", "permissions.json");
    const engPerms = JSON.parse(fs.readFileSync(engPermsPath, "utf8")) as { allowedTools: string[] };
    engPerms.allowedTools.push("mcp:tiny:echo");
    fs.writeFileSync(engPermsPath, JSON.stringify(engPerms), "utf8");
    ctx.companyStore.reloadAll();

    const execRes = await ctx.mcpManager.callTool({
      serverId: "tiny",
      toolName: "echo",
      args: { ping: 1 },
      employeeId: "senior-engineer",
      runId: "r-ok",
    });
    expect(execRes.outcome).toBe("executed");
    expect(execRes.output).toContain("top_secret_val_99");

    // Tier 3 override tool must require approval
    const tier3Res = await ctx.mcpManager.callTool({
      serverId: "tiny",
      toolName: "deploy_prod",
      args: {},
      employeeId: "senior-engineer",
      runId: "r-t3",
    });
    expect(tier3Res.outcome).toBe("require_approval");
  });
});
