import fs from "node:fs";
import path from "node:path";
import { MemoryCitationSchema, redactSecrets } from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import { atomicWriteFile, assertPathWithinRoots } from "../company/index.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { TasksRepository } from "../db/repositories/tasks-repo.js";
import type { ApprovalEngine } from "../governance/approval-engine.js";
import type { RunTokenClaims } from "../governance/auth.js";
import type { MemoryManager } from "../memory/memory-manager.js";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const OFFICE_MCP_TOOLS = [
  {
    name: "office_search_memory",
    description: "Search Virtual Office Markdown/FTS5 (+ optional vector) memory scoped strictly to this employee and project.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Search query in Arabic or English" } },
      required: ["q"],
    },
  },
  {
    name: "office_save_working_note",
    description:
      "Save a working-memory note scoped to this employee or active project. Never promotes unverified text to semantic/procedural truth without human/tool verification.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        scope: { type: "string", enum: ["employee", "project"] },
        citations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["conversation", "file", "command", "run", "url", "human"] },
              ref: { type: "string" },
              summary: { type: "string" },
            },
            required: ["kind", "ref"],
          },
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "office_list_tasks",
    description: "List tasks on the active project Kanban board.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "office_create_task",
    description: "Create a new task on the active project board.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignedEmployeeId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "office_write_deliverable",
    description: "Write a deliverable file safely inside company/deliverables.",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Relative deliverable filename (e.g. report.md)" },
        content: { type: "string" },
      },
      required: ["fileName", "content"],
    },
  },
  {
    name: "office_request_approval",
    description: "Request founder Tier 3 Approval before performing any external or sensitive action.",
    inputSchema: {
      type: "object",
      properties: {
        actionType: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        payload: { type: "object" },
        diffPreview: { type: "string" },
      },
      required: ["actionType", "title", "summary"],
    },
  },
];

/**
 * Internal `office-mcp` JSON-RPC 2.0 server scoped by verified `RunTokenClaims`.
 * Prevents agent spoofing and cross-project/cross-employee memory leakage.
 */
export class OfficeMcpServer {
  constructor(
    private readonly companyStore: CompanyStore,
    private readonly memoryRepo: MemoryRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly runsRepo: RunsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly onRunStatusChanged?: (runId: string) => void,
    private readonly memoryManager?: MemoryManager,
  ) {}

  public async handleJsonRpc(
    req: JsonRpcRequest,
    claims: RunTokenClaims,
  ): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    if (req.method === "notifications/initialized") {
      return null;
    }

    if (req.method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "office-mcp", version: "0.2.0" },
        },
      };
    }

    if (req.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: OFFICE_MCP_TOOLS },
      };
    }

    if (req.method === "tools/call") {
      const params = req.params ?? {};
      const toolName = String(params.name ?? "");
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};

      try {
        const output = await this.executeTool(toolName, args, claims);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output) }],
            isError: false,
          },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: err instanceof Error ? err.message : "office-mcp tool error",
              },
            ],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
  }

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    claims: RunTokenClaims,
  ): Promise<unknown> {
    if (toolName === "office_search_memory") {
      const q = String(args.q ?? "");
      const entries = this.memoryManager
        ? (
            await this.memoryManager.search({
              q,
              forEmployeeId: claims.employeeId,
              forProjectId: claims.projectId,
              limit: 10,
            })
          ).entries
        : this.memoryRepo.search({
            q,
            forEmployeeId: claims.employeeId,
            forProjectId: claims.projectId,
            limit: 10,
          });
      this.memoryRepo.touchAccessed(entries.map((e) => e.id));
      return {
        entries: entries.map((e) => ({
          id: e.id,
          scope: e.scope,
          memoryType: e.memoryType,
          title: e.title,
          verifiedBy: e.verifiedBy,
          confidence: e.confidence,
          decayScore: e.decayScore,
          effectiveScore: e.effectiveScore,
          retrievalMode: e.retrievalMode,
          content: e.content,
          citations: e.sourceCitations,
        })),
      };
    }

    if (toolName === "office_save_working_note") {
      if (!this.memoryManager) {
        throw new Error("MemoryManager is not configured.");
      }
      const title = String(args.title ?? "").trim();
      const content = String(args.content ?? "").trim();
      if (!title || !content) {
        throw new Error("title and content are required.");
      }
      const requestedScope = args.scope === "project" && claims.projectId ? "project" : "employee";
      const runEvents = this.runsRepo.getRunEventsAfter(claims.runId, 0);
      const isTainted = runEvents.some(
        (e) =>
          (e.event.type === "context_assembled" && e.event.hasUntrustedExternalInput) ||
          e.eventType === "tainted_input",
      );

      const rawCitations = Array.isArray(args.citations) ? args.citations : [];
      const validCitations = rawCitations
        .map((c) => MemoryCitationSchema.safeParse(c))
        .filter((r) => r.success)
        .map((r) => r.data);
      const hasEvidenceCitation = validCitations.some(
        (c) => c.kind === "command" || c.kind === "file",
      );
      const verifiedBy = !isTainted && hasEvidenceCitation ? "tool_output" : "unverified";

      const result = await this.memoryManager.writeMemoryEntry({
        scope: requestedScope,
        projectId: requestedScope === "project" ? claims.projectId : null,
        employeeId: requestedScope === "employee" ? claims.employeeId : null,
        memoryType: "working",
        title,
        content,
        sourceCitations: [
          ...validCitations,
          { kind: "conversation", ref: claims.runId, summary: "Saved during active run" },
        ],
        confidence: verifiedBy === "tool_output" ? 0.7 : 0.4,
        verifiedBy,
        taintedByExternalInput: isTainted,
      });

      return {
        saved: true,
        id: result.entry.id,
        status: result.entry.status,
        memoryType: result.entry.memoryType,
        verifiedBy: result.entry.verifiedBy,
        conflictDetected: result.conflictDetected,
        conflictReason: result.entry.conflictReason,
      };
    }

    if (toolName === "office_list_tasks") {
      return {
        tasks: this.tasksRepo.list({ projectId: claims.projectId ?? undefined }),
      };
    }

    if (toolName === "office_create_task") {
      const title = String(args.title ?? "").trim();
      if (!title) {
        throw new Error("title is required");
      }
      const task = this.tasksRepo.create({
        title,
        description: String(args.description ?? ""),
        projectId: claims.projectId,
        assignedEmployeeId:
          typeof args.assignedEmployeeId === "string"
            ? args.assignedEmployeeId
            : claims.employeeId,
        status: "todo",
        priority: "medium",
      });
      return { task };
    }

    if (toolName === "office_write_deliverable") {
      const rawName = String(args.fileName ?? "").trim();
      if (!rawName || rawName.includes("..") || path.isAbsolute(rawName)) {
        throw new Error("Invalid deliverable fileName: path traversal is forbidden.");
      }
      const deliverablesBase = path.join(this.companyStore.companyRoot, "deliverables");
      const projectBucket = path.join(deliverablesBase, claims.projectId ?? "general");
      fs.mkdirSync(projectBucket, { recursive: true });
      const targetPath = assertPathWithinRoots(path.join(projectBucket, rawName), [
        deliverablesBase,
      ]);
      const content = redactSecrets(String(args.content ?? ""));
      atomicWriteFile(targetPath, content);
      return {
        saved: true,
        relativePath: path.relative(this.companyStore.companyRoot, targetPath).replace(/\\/g, "/"),
      };
    }

    if (toolName === "office_request_approval") {
      const actionType = String(args.actionType ?? "external_action");
      const title = String(args.title ?? `Approval: ${actionType}`);
      const summary = String(args.summary ?? "Requested via office-mcp");
      const payload =
        args.payload && typeof args.payload === "object"
          ? (args.payload as Record<string, unknown>)
          : {};
      const diffPreview = typeof args.diffPreview === "string" ? args.diffPreview : undefined;

      // Propagate external-input taint from run's context_assembled event if present
      const runEvents = this.runsRepo.getRunEventsAfter(claims.runId, 0);
      const isTainted = runEvents.some(
        (e) =>
          (e.event.type === "context_assembled" && e.event.hasUntrustedExternalInput) ||
          e.eventType === "tainted_input",
      );

      const approval = this.approvalEngine.createApproval({
        runId: claims.runId,
        employeeId: claims.employeeId,
        projectId: claims.projectId,
        actionType,
        riskTier: "tier3_approval",
        title,
        summary,
        payload,
        diffPreview,
        taintedByExternalInput: isTainted,
      });

      const nextSeq = (runEvents[runEvents.length - 1]?.runSeq ?? 0) + 1;
      this.runsRepo.appendRunEvent(claims.runId, nextSeq, {
        type: "approval_requested",
        actionType,
        riskTier: "tier3_approval",
        title,
        summary,
        payload: { ...payload, approvalId: approval.id },
        diffPreview,
      });
      this.runsRepo.updateStatus(claims.runId, "WAITING_APPROVAL", {});
      this.onRunStatusChanged?.(claims.runId);

      return {
        status: "PENDING_APPROVAL",
        approvalId: approval.id,
        instruction: "Stop execution now and summarize the approval request for the founder.",
      };
    }

    throw new Error(`Unknown office-mcp tool: ${toolName}`);
  }
}
