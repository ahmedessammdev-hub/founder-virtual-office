import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  isSensitiveFilePath,
  redactSecrets,
  type BrowserSecurityPolicy,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import { atomicWriteFile, assertPathWithinRoots, assertReadableProjectFile } from "../company/index.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { CredentialVault } from "../governance/vault.js";
import { sanitizeAndSpillOutput } from "../governance/output-guard.js";

export class BrowserGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserGuardError";
  }
}

function isPrivateOrLoopbackIp(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    clean === "localhost" ||
    clean.endsWith(".localhost") ||
    clean === "0.0.0.0" ||
    clean === "::" ||
    clean === "::1"
  ) {
    return true;
  }

  const ipVersion = net.isIP(clean);
  if (ipVersion === 0) {
    return false;
  }
  // Block ALL direct IP literals (v4 and v6) against SSRF / cloud metadata bypasses
  return true;
}

function domainMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowlist.some((pattern) => {
    const cleanPattern = pattern.trim().toLowerCase();
    if (!cleanPattern) return false;
    return lower === cleanPattern || lower.endsWith(`.${cleanPattern}`);
  });
}

/**
 * Enforces SSRF & Domain Allowlist protection for controlled `browser_fetch`.
 */
export function assertAllowedBrowserUrl(
  rawUrl: string,
  policy: BrowserSecurityPolicy,
  options?: { allowHttpForTesting?: boolean },
): URL {
  if (!policy.enabled) {
    throw new BrowserGuardError("Controlled browser access is disabled by company security policy.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BrowserGuardError(`Invalid URL: "${rawUrl}"`);
  }

  const allowedProto = options?.allowHttpForTesting
    ? parsed.protocol === "https:" || parsed.protocol === "http:"
    : parsed.protocol === "https:";
  if (!allowedProto) {
    throw new BrowserGuardError(`Blocked URL scheme "${parsed.protocol}": only HTTPS is allowed.`);
  }

  if (parsed.username || parsed.password) {
    throw new BrowserGuardError("Blocked URL containing embedded credentials.");
  }

  if (!options?.allowHttpForTesting && isPrivateOrLoopbackIp(parsed.hostname)) {
    throw new BrowserGuardError(`SSRF blocked for private/loopback host "${parsed.hostname}".`);
  }

  if (!domainMatchesAllowlist(parsed.hostname, policy.domainAllowlist)) {
    throw new BrowserGuardError(
      `Domain "${parsed.hostname}" is not in company browser domainAllowlist.`,
    );
  }

  return parsed;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GatewayToolContext {
  runId: string;
  employeeId: string;
  projectId: string | null;
  workingDir: string;
  artifactsDir: string;
  companyStore: CompanyStore;
  memoryRepo: MemoryRepository;
  tasksRepo: TasksRepository;
  vault: CredentialVault;
  markTainted: () => void;
}

export interface GatewayToolResult {
  success: boolean;
  output: string;
  artifactPath?: string;
  truncated?: boolean;
  taintedExternal?: boolean;
}

function walkWorkspaceFiles(rootDir: string, maxFiles = 200): string[] {
  const results: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", ".next", "data"]);

  function visit(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && !isSensitiveFilePath(full)) {
        results.push(full);
      }
    }
  }

  visit(rootDir);
  return results;
}

export async function executeBuiltInGatewayTool(
  ctx: GatewayToolContext,
  toolName: string,
  args: Record<string, unknown>,
  stepCounter: number,
): Promise<GatewayToolResult> {
  const emp = ctx.companyStore.getEmployee(ctx.employeeId);
  if (!emp) {
    return { success: false, output: `Unknown employee "${ctx.employeeId}".` };
  }
  const project = ctx.projectId ? ctx.companyStore.getProject(ctx.projectId) : null;
  const allowedRoots = [
    emp.rootDir,
    path.join(ctx.companyStore.companyRoot, "memory"),
    path.join(ctx.companyStore.companyRoot, "deliverables"),
    ...(project ? [project.rootPath] : []),
  ];

  if (toolName === "read_file") {
    const relOrAbs = String(args.path ?? "");
    if (!relOrAbs) {
      return { success: false, output: "Missing required argument: path" };
    }
    const target = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(ctx.workingDir, relOrAbs);
    const canonical = assertReadableProjectFile(target, allowedRoots);
    const raw = fs.readFileSync(canonical, "utf8");
    const guarded = sanitizeAndSpillOutput({
      runId: ctx.runId,
      stepKey: `tool_${stepCounter}_read`,
      rawText: raw,
      artifactsDir: ctx.artifactsDir,
    });
    return {
      success: true,
      output: guarded.preview,
      artifactPath: guarded.artifactPath,
      truncated: guarded.truncated,
    };
  }

  if (toolName === "search") {
    const query = String(args.query ?? args.q ?? "").trim().toLowerCase();
    const files = walkWorkspaceFiles(ctx.workingDir, 180);
    if (!query) {
      return {
        success: true,
        output: files.slice(0, 40).map((f) => path.relative(ctx.workingDir, f)).join("\n"),
      };
    }
    const matches: string[] = [];
    for (const file of files) {
      if (matches.length >= 25) break;
      try {
        const text = fs.readFileSync(file, "utf8");
        const lines = text.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (matches.length < 25 && line.toLowerCase().includes(query)) {
            matches.push(`${path.relative(ctx.workingDir, file)}:${idx + 1}: ${redactSecrets(line.trim()).slice(0, 140)}`);
          }
        });
      } catch {
        // Skip binary/unreadable files
      }
    }
    return {
      success: true,
      output: matches.length > 0 ? matches.join("\n") : `No matches for "${query}".`,
    };
  }

  if (toolName === "browser_fetch") {
    const rawUrl = String(args.url ?? "");
    const companyPolicy: BrowserSecurityPolicy = ctx.companyStore.getCompanyConfig().security ?? {
      enabled: true,
      domainAllowlist: ["github.com", "api.github.com", "docs.github.com", "npmjs.com", "developer.mozilla.org"],
      maxResponseBytes: 262_144,
    };
    const safeUrl = assertAllowedBrowserUrl(rawUrl, companyPolicy);
    ctx.markTainted();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(safeUrl.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "VirtualOffice-ControlledBrowser/0.2" },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (location) {
          const redirected = assertAllowedBrowserUrl(
            new URL(location, safeUrl).toString(),
            companyPolicy,
          );
          return {
            success: false,
            output: `Redirect target verified (${redirected.toString()}); please fetch redirected URL directly.`,
            taintedExternal: true,
          };
        }
      }
      const rawText = await resp.text();
      const capped = rawText.slice(0, companyPolicy.maxResponseBytes);
      const cleanText = stripHtmlToText(capped);
      const wrapped = `<untrusted_external_data source="url:${safeUrl.toString()}">\n${redactSecrets(cleanText)}\n</untrusted_external_data>`;
      const guarded = sanitizeAndSpillOutput({
        runId: ctx.runId,
        stepKey: `tool_${stepCounter}_browser`,
        rawText: wrapped,
        artifactsDir: ctx.artifactsDir,
      });
      return {
        success: resp.ok,
        output: guarded.preview,
        artifactPath: guarded.artifactPath,
        truncated: guarded.truncated,
        taintedExternal: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (toolName === "github_list_issues") {
    const owner = String(args.owner ?? "").trim();
    const repo = String(args.repo ?? "").trim();
    if (!owner || !repo) {
      return { success: false, output: "Required arguments: owner, repo" };
    }
    ctx.markTainted();
    const ghToken = ctx.vault.resolveSecret("GITHUB_TOKEN");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "VirtualOffice-GitHubTool/0.2",
    };
    if (ghToken) {
      headers.Authorization = `Bearer ${ghToken}`;
    }
    const resp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?per_page=10`,
      { headers },
    );
    const body = redactSecrets(await resp.text());
    if (!resp.ok) {
      return { success: false, output: `GitHub API ${resp.status}: ${body.slice(0, 400)}`, taintedExternal: true };
    }
    const wrapped = `<untrusted_external_data source="github:${owner}/${repo}/issues">\n${body}\n</untrusted_external_data>`;
    const guarded = sanitizeAndSpillOutput({
      runId: ctx.runId,
      stepKey: `tool_${stepCounter}_github`,
      rawText: wrapped,
      artifactsDir: ctx.artifactsDir,
    });
    return {
      success: true,
      output: guarded.preview,
      artifactPath: guarded.artifactPath,
      truncated: guarded.truncated,
      taintedExternal: true,
    };
  }

  if (toolName === "office_search_memory") {
    const q = String(args.q ?? args.query ?? "");
    const entries = ctx.memoryRepo.search({
      q,
      forEmployeeId: ctx.employeeId,
      forProjectId: ctx.projectId,
      limit: 8,
    });
    return {
      success: true,
      output: JSON.stringify(
        entries.map((e) => ({
          id: e.id,
          scope: e.scope,
          title: e.title,
          verifiedBy: e.verifiedBy,
          confidence: e.confidence,
          content: e.content.slice(0, 400),
        })),
      ),
    };
  }

  if (toolName === "office_list_tasks") {
    const tasks = ctx.tasksRepo.list({ projectId: ctx.projectId ?? undefined });
    return { success: true, output: JSON.stringify(tasks.slice(0, 20)) };
  }

  if (toolName === "office_create_task") {
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { success: false, output: "Missing task title" };
    }
    const task = ctx.tasksRepo.create({
      title,
      description: String(args.description ?? ""),
      projectId: ctx.projectId,
      assignedEmployeeId: typeof args.assignedEmployeeId === "string" ? args.assignedEmployeeId : ctx.employeeId,
      status: "todo",
      priority: "medium",
    });
    return { success: true, output: JSON.stringify(task) };
  }

  if (toolName === "office_write_deliverable") {
    const fileName = path.basename(String(args.fileName ?? "deliverable.md")).replace(/[^a-zA-Z0-9._-]/g, "_");
    const content = String(args.content ?? "");
    const deliverablesRoot = path.join(
      ctx.companyStore.companyRoot,
      "deliverables",
      ctx.projectId ?? "general",
    );
    fs.mkdirSync(deliverablesRoot, { recursive: true });
    const targetPath = assertPathWithinRoots(path.join(deliverablesRoot, fileName), [
      path.join(ctx.companyStore.companyRoot, "deliverables"),
    ]);
    atomicWriteFile(targetPath, redactSecrets(content));
    return {
      success: true,
      output: JSON.stringify({
        saved: true,
        path: path.relative(ctx.companyStore.companyRoot, targetPath).replace(/\\/g, "/"),
      }),
    };
  }

  return {
    success: false,
    output: `Built-in tool "${toolName}" has no local gateway executor in this runtime.`,
  };
}

export const BUILT_IN_TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description: "Read a file inside the active project workspace or your employee directory (.env/secrets blocked).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative or workspace file path" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Search source files in the active project workspace.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Text query to search" } },
      required: ["query"],
    },
  },
  {
    name: "browser_fetch",
    description: "Fetch readable text from an allowlisted HTTPS URL (wrapped as untrusted external data).",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "HTTPS URL in domainAllowlist" } },
      required: ["url"],
    },
  },
  {
    name: "github_list_issues",
    description: "Read recent GitHub issues for a repository.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_create_issue",
    description: "Create a GitHub issue (Tier 3: requires founder approval).",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "office_search_memory",
    description: "Search verified Virtual Office memory scoped to this employee and project.",
    parameters: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    },
  },
  {
    name: "office_list_tasks",
    description: "List tasks on the active project board.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "office_create_task",
    description: "Create a task on the active project board.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "office_write_deliverable",
    description: "Save a deliverable markdown/text artifact inside company/deliverables.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        content: { type: "string" },
      },
      required: ["fileName", "content"],
    },
  },
];
