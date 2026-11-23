import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  McpRegistrySchema,
  McpServerConfigSchema,
  redactSecrets,
  type McpRegistry,
  type McpServerConfig,
  type McpServerConfigInput,
  type RiskTier,
} from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { PolicyGuard } from "../governance/policy-guard.js";
import { sanitizeAndSpillOutput } from "../governance/output-guard.js";
import type { CredentialVault } from "../governance/vault.js";
import { buildSafeChildEnv, resolveExecutable } from "../runtime/env-builder.js";
import { killProcessTree } from "../runtime/process-killer.js";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTestResult {
  ok: boolean;
  serverId: string;
  latencyMs: number;
  tools: McpToolDefinition[];
  error?: string;
}

export interface McpTemplate {
  id: string;
  name: string;
  description: string;
  config: McpServerConfigInput;
}

const STARTER_TEMPLATES: McpTemplate[] = [
  {
    id: "github",
    name: "GitHub MCP",
    description: "Official GitHub repository, issues, and PR tools (requires GITHUB_TOKEN in Vault).",
    config: {
      id: "github",
      name: "GitHub MCP",
      description: "GitHub issues, PRs, and code search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envVaultKeys: ["GITHUB_TOKEN"],
      enabled: true,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {
        create_issue: "tier3_approval",
        create_pull_request: "tier3_approval",
        push_files: "tier3_approval",
      },
    },
  },
  {
    id: "playwright",
    name: "Playwright Browser MCP",
    description: "Controlled browser automation for web research and UI verification.",
    config: {
      id: "playwright",
      name: "Playwright MCP",
      description: "Browser navigation, DOM extraction, and screenshots",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      envVaultKeys: [],
      enabled: true,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {},
    },
  },
  {
    id: "filesystem",
    name: "Filesystem MCP",
    description: "Read-only scoped directory access via MCP filesystem server.",
    config: {
      id: "filesystem",
      name: "Filesystem MCP",
      description: "Scoped workspace filesystem MCP",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      envVaultKeys: [],
      enabled: true,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {
        write_file: "tier2_guarded",
        edit_file: "tier2_guarded",
      },
    },
  },
  {
    id: "fetch",
    name: "Fetch Web MCP",
    description: "Lightweight HTTP/Markdown fetcher MCP.",
    config: {
      id: "fetch",
      name: "Fetch MCP",
      description: "Fetch public web pages as readable markdown",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      envVaultKeys: [],
      enabled: true,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {},
    },
  },
  {
    id: "google-workspace",
    name: "Google Workspace MCP",
    description:
      "Least-privilege Gmail, Calendar, and Drive connector (reads auto, sends/deletes require Tier 3 approval).",
    config: {
      id: "google-workspace",
      name: "Google Workspace MCP",
      description: "Gmail, Google Calendar, and Drive scoped via OAuth secrets in Vault",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gdrive"],
      envVaultKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      enabled: false,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {
        send_email: "tier3_approval",
        create_calendar_event: "tier3_approval",
        delete_file: "tier3_approval",
        share_file: "tier3_approval",
      },
    },
  },
  {
    id: "notion",
    name: "Notion Workspace MCP",
    description:
      "Search and read Notion docs/databases with all page/block edits gated behind Tier 3 approval.",
    config: {
      id: "notion",
      name: "Notion Workspace MCP",
      description: "Notion search & workspace integration using NOTION_API_KEY",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      envVaultKeys: ["NOTION_API_KEY"],
      enabled: false,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {
        create_page: "tier3_approval",
        update_page: "tier3_approval",
        delete_block: "tier3_approval",
      },
    },
  },
  {
    id: "slack",
    name: "Slack Workspace MCP",
    description:
      "Read channel summaries safely while gating outbound Slack messages behind Tier 3 approval.",
    config: {
      id: "slack",
      name: "Slack Workspace MCP",
      description: "Slack channels & history via SLACK_BOT_TOKEN and SLACK_TEAM_ID",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      envVaultKeys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
      enabled: false,
      defaultRiskTier: "tier1_auto",
      allowedEmployeeIds: "*",
      toolRiskOverrides: {
        post_message: "tier3_approval",
        reply_to_thread: "tier3_approval",
      },
    },
  },
];

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private rl: readline.Interface | null = null;

  constructor(
    private readonly config: McpServerConfig,
    private readonly vault: CredentialVault,
    private readonly workingDir: string,
  ) {}

  public async connect(timeoutMs = 15_000): Promise<void> {
    if (!this.config.command) {
      throw new Error(`MCP server "${this.config.id}" missing stdio command.`);
    }
    const exe =
      path.isAbsolute(this.config.command)
        ? this.config.command
        : (resolveExecutable(this.config.command) ?? this.config.command);

    const injectedEnv: Record<string, string> = {};
    for (const key of this.config.envVaultKeys) {
      const val = this.vault.resolveSecret(key);
      if (val) {
        injectedEnv[key] = val;
      }
    }

    const useShellShim =
      process.platform === "win32" &&
      (exe.toLowerCase().endsWith(".cmd") || exe.toLowerCase().endsWith(".bat"));
    const spawnCmd = useShellShim ? "cmd.exe" : exe;
    const spawnArgs = useShellShim
      ? ["/c", exe, ...this.config.args]
      : this.config.args;

    this.child = spawn(spawnCmd, spawnArgs, {
      cwd: this.workingDir,
      env: buildSafeChildEnv([], injectedEnv),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(msg.error.message ?? "MCP server error"));
          } else {
            entry.resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON startup chatter
      }
    });

    this.child.on("exit", (code) => {
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`MCP server "${this.config.id}" exited (code ${code})`));
        this.pending.delete(id);
      }
    });

    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "virtual-office", version: "0.2.0" },
      },
      timeoutMs,
    );
    this.notify("notifications/initialized");
  }

  public notify(method: string, params?: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  public request(method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error(`MCP server "${this.config.id}" is not connected.`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  public async listTools(): Promise<McpToolDefinition[]> {
    const res = (await this.request("tools/list", {})) as { tools?: McpToolDefinition[] };
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args }, 25_000);
  }

  public async close(): Promise<void> {
    this.rl?.close();
    this.rl = null;
    if (this.child) {
      const pid = this.child.pid;
      this.child = null;
      await killProcessTree(pid);
    }
  }
}

export class McpManager {
  private registryPath: string;
  private registry: McpRegistry = { servers: [] };
  private activeClients = new Set<StdioMcpClient>();

  constructor(
    private readonly companyRoot: string,
    private readonly vault: CredentialVault,
    private readonly policyGuard: PolicyGuard,
    private readonly auditRepo: AuditRepository,
    private readonly artifactsDir: string,
  ) {
    this.registryPath = path.join(companyRoot, "mcps.json");
    this.reload();
  }

  public reload(): void {
    if (!fs.existsSync(this.registryPath)) {
      this.registry = { servers: [] };
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf8")) as unknown;
    this.registry = McpRegistrySchema.parse(parsed);
  }

  private save(): void {
    atomicWriteFile(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  public getTemplates(): McpTemplate[] {
    return STARTER_TEMPLATES;
  }

  public listServers(): McpServerConfig[] {
    return this.registry.servers;
  }

  public getServer(id: string): McpServerConfig | null {
    return this.registry.servers.find((s) => s.id === id) ?? null;
  }

  public upsertServer(input: McpServerConfigInput): McpServerConfig {
    const config = McpServerConfigSchema.parse(input);
    const idx = this.registry.servers.findIndex((s) => s.id === config.id);
    if (idx === -1) {
      this.registry.servers.push(config);
    } else {
      this.registry.servers[idx] = config;
    }
    this.save();
    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "mcp.upserted",
      targetType: "mcp_server",
      targetId: config.id,
      status: "OK",
      details: { transport: config.transport, enabled: config.enabled },
    });
    return config;
  }

  public patchServer(id: string, patch: Partial<McpServerConfigInput>): McpServerConfig | null {
    const existing = this.getServer(id);
    if (!existing) return null;
    return this.upsertServer({ ...existing, ...patch, id });
  }

  public deleteServer(id: string): boolean {
    const before = this.registry.servers.length;
    this.registry.servers = this.registry.servers.filter((s) => s.id !== id);
    if (this.registry.servers.length === before) return false;
    this.save();
    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "mcp.deleted",
      targetType: "mcp_server",
      targetId: id,
      status: "OK",
    });
    return true;
  }

  public async testServer(id: string): Promise<McpTestResult> {
    const server = this.getServer(id);
    if (!server) {
      return { ok: false, serverId: id, latencyMs: 0, tools: [], error: "MCP server not found." };
    }

    const start = Date.now();
    if (server.transport === "http") {
      if (!server.url) {
        return { ok: false, serverId: id, latencyMs: 0, tools: [], error: "Missing HTTP MCP URL." };
      }
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (server.envVaultKeys[0]) {
          const tok = this.vault.resolveSecret(server.envVaultKeys[0]);
          if (tok) headers.Authorization = `Bearer ${tok}`;
        }
        await this.httpRpc(server.url, headers, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "virtual-office", version: "0.2.0" },
        });
        const listRes = (await this.httpRpc(server.url, headers, "tools/list", {})) as {
          tools?: McpToolDefinition[];
        };
        return {
          ok: true,
          serverId: id,
          latencyMs: Date.now() - start,
          tools: Array.isArray(listRes?.tools) ? listRes.tools : [],
        };
      } catch (err) {
        return {
          ok: false,
          serverId: id,
          latencyMs: Date.now() - start,
          tools: [],
          error: err instanceof Error ? err.message : "HTTP MCP connection failed",
        };
      }
    }

    const client = new StdioMcpClient(server, this.vault, this.companyRoot);
    this.activeClients.add(client);
    try {
      await client.connect(12_000);
      const tools = await client.listTools();
      return {
        ok: true,
        serverId: id,
        latencyMs: Date.now() - start,
        tools,
      };
    } catch (err) {
      return {
        ok: false,
        serverId: id,
        latencyMs: Date.now() - start,
        tools: [],
        error: redactSecrets(err instanceof Error ? err.message : "Stdio MCP test failed"),
      };
    } finally {
      await client.close();
      this.activeClients.delete(client);
    }
  }

  public async callTool(input: {
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
    employeeId: string;
    runId: string;
    projectId?: string | null;
  }): Promise<{
    outcome: "executed" | "require_approval" | "denied";
    output?: string;
    artifactPath?: string;
    truncated?: boolean;
    reason?: string;
    requiredTier?: RiskTier;
  }> {
    const server = this.getServer(input.serverId);
    if (!server || !server.enabled) {
      return {
        outcome: "denied",
        reason: `MCP server "${input.serverId}" is missing or disabled.`,
      };
    }

    if (
      server.allowedEmployeeIds !== "*" &&
      !server.allowedEmployeeIds.includes(input.employeeId)
    ) {
      return {
        outcome: "denied",
        reason: `Employee "${input.employeeId}" is not permitted to use MCP server "${input.serverId}".`,
      };
    }

    const effectiveTier = server.toolRiskOverrides[input.toolName] ?? server.defaultRiskTier;
    const policy = this.policyGuard.evaluate({
      employeeId: input.employeeId,
      toolName: input.toolName,
      requestedRiskTier: effectiveTier,
      projectId: input.projectId,
      mcpServerId: input.serverId,
    });

    if (policy.outcome === "deny") {
      return { outcome: "denied", reason: policy.reason };
    }
    if (policy.outcome === "require_approval") {
      return {
        outcome: "require_approval",
        reason: policy.reason,
        requiredTier: policy.requiredTier,
      };
    }

    let rawResult: unknown;
    if (server.transport === "http") {
      if (!server.url) {
        return { outcome: "denied", reason: "Missing HTTP MCP URL." };
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (server.envVaultKeys[0]) {
        const tok = this.vault.resolveSecret(server.envVaultKeys[0]);
        if (tok) headers.Authorization = `Bearer ${tok}`;
      }
      rawResult = await this.httpRpc(server.url, headers, "tools/call", {
        name: input.toolName,
        arguments: input.args,
      });
    } else {
      const client = new StdioMcpClient(server, this.vault, this.companyRoot);
      this.activeClients.add(client);
      try {
        await client.connect(12_000);
        rawResult = await client.callTool(input.toolName, input.args);
      } finally {
        await client.close();
        this.activeClients.delete(client);
      }
    }

    const rawText = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    const guarded = sanitizeAndSpillOutput({
      runId: input.runId,
      stepKey: `mcp_${input.serverId}_${input.toolName}`,
      rawText,
      artifactsDir: this.artifactsDir,
    });

    this.auditRepo.log({
      actorType: "employee",
      actorId: input.employeeId,
      action: "mcp.tool_called",
      targetType: "mcp_server",
      targetId: `${input.serverId}:${input.toolName}`,
      status: "OK",
      details: { runId: input.runId, truncated: guarded.truncated },
    });

    return {
      outcome: "executed",
      output: guarded.preview,
      artifactPath: guarded.artifactPath,
      truncated: guarded.truncated,
    };
  }

  private async httpRpc(
    url: string,
    headers: Record<string, string>,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP MCP returned ${resp.status}`);
    }
    const json = (await resp.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) {
      throw new Error(json.error.message ?? "HTTP MCP error");
    }
    return json.result;
  }

  public async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.activeClients).map((c) => c.close()));
    this.activeClients.clear();
  }
}
