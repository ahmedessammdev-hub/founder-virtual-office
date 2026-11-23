import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Run } from "@virtual-office/shared";
import { CompanyStore } from "../src/company/company-store.js";
import { MemoryIndexer } from "../src/company/memory-indexer.js";
import { OfficeDatabase } from "../src/db/database.js";
import {
  ApprovalsRepository,
  AuditRepository,
  ConversationsRepository,
  MemoryRepository,
  RunsRepository,
  TasksRepository,
  UsageRepository,
} from "../src/db/repositories/index.js";
import { ApprovalEngine } from "../src/governance/approval-engine.js";
import { BudgetGovernor } from "../src/governance/budget-governor.js";
import { PolicyGuard } from "../src/governance/policy-guard.js";
import { CredentialVault, StaticMasterKeyProvider } from "../src/governance/vault.js";
import { McpManager } from "../src/mcp/mcp-manager.js";
import { JobSupervisor } from "../src/runtime/job-supervisor.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

function waitForRun(runsRepo: RunsRepository, runId: string, timeoutMs = 10_000): Promise<Run> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const r = runsRepo.getById(runId);
      if (
        r &&
        ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "BUDGET_EXCEEDED", "WAITING_APPROVAL"].includes(
          r.status,
        )
      ) {
        clearInterval(timer);
        resolve(r);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Run ${runId} timed out (status=${r?.status})`));
      }
    }, 20);
  });
}

describe("Direct API Adapters, Ollama Streaming, Tool Loop & Safe Fallback Policy", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function startMockProviderHttpServer() {
    let openaiTurn = 0;
    let openaiMode: "tool_loop" | "tier3" | "rate_limit" | "auth_error" = "tool_loop";

    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const url = req.url ?? "";

      // OpenAI / OpenRouter compatible endpoint
      if (url.endsWith("/chat/completions")) {
        if (openaiMode === "auth_error") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
          return;
        }
        if (openaiMode === "rate_limit") {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
          return;
        }
        if (openaiMode === "tier3") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "tc_tier3",
                        function: {
                          name: "github_create_issue",
                          arguments: JSON.stringify({
                            owner: "founder",
                            repo: "app",
                            title: "Ship v1",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 150, completion_tokens: 40 },
            }),
          );
          return;
        }

        openaiTurn += 1;
        if (openaiTurn === 1) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "tc_mem",
                        function: {
                          name: "office_search_memory",
                          arguments: JSON.stringify({ q: "تشغيل" }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 120, completion_tokens: 30 },
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "تم التحقق من مبادئ التشغيل عبر أداة الذاكرة بنجاح.",
                },
              },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 55 },
          }),
        );
        return;
      }

      // Gemini endpoint
      if (url.includes(":generateContent")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: "GEMINI_FALLBACK_OK" }] },
              },
            ],
            usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 20 },
          }),
        );
        return;
      }

      // Anthropic endpoint
      if (url.endsWith("/messages")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            content: [{ type: "text", text: "ANTHROPIC_OK" }],
            usage: { input_tokens: 80, output_tokens: 15 },
          }),
        );
        return;
      }

      // Ollama streaming NDJSON endpoint
      if (url.endsWith("/api/chat")) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ message: { role: "assistant", content: "OLLAMA_" }, done: false })}\n`);
        res.write(`${JSON.stringify({ message: { role: "assistant", content: "LOCAL_OK" }, done: true, prompt_eval_count: 60, eval_count: 14 })}\n`);
        res.end();
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    return {
      baseUrl,
      setOpenaiMode: (m: typeof openaiMode) => {
        openaiMode = m;
        openaiTurn = 0;
      },
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  function setupDirectSupervisor(mockBaseUrl: string) {
    const tmp = createTempOfficeDirs();
    const db = new OfficeDatabase(path.join(tmp.dataDir, "test.db"));
    const memoryRepo = new MemoryRepository(db.db);
    const memoryIndexer = new MemoryIndexer(tmp.companyRoot, memoryRepo);
    const companyStore = new CompanyStore(tmp.companyRoot, memoryIndexer);
    const runsRepo = new RunsRepository(db.db);
    const conversationsRepo = new ConversationsRepository(db.db);
    const tasksRepo = new TasksRepository(db.db);
    const usageRepo = new UsageRepository(db.db);
    const auditRepo = new AuditRepository(db.db);
    const approvalsRepo = new ApprovalsRepository(db.db);
    const policyGuard = new PolicyGuard(companyStore);
    const approvalEngine = new ApprovalEngine(approvalsRepo, auditRepo, companyStore);
    const budgetGovernor = new BudgetGovernor(companyStore, usageRepo);
    const vault = new CredentialVault(
      path.join(tmp.dataDir, "vault.enc.json"),
      new StaticMasterKeyProvider(crypto.randomBytes(32)),
    );
    const mcpManager = new McpManager(
      tmp.companyRoot,
      vault,
      policyGuard,
      auditRepo,
      path.join(tmp.dataDir, "artifacts"),
    );

    const supervisor = new JobSupervisor(
      companyStore,
      runsRepo,
      conversationsRepo,
      memoryRepo,
      usageRepo,
      auditRepo,
      policyGuard,
      approvalEngine,
      budgetGovernor,
      {
        artifactsDir: path.join(tmp.dataDir, "artifacts"),
        deltaFlushIntervalMs: 30,
        tasksRepo,
        vault,
        mcpManager,
        directApiBaseUrls: {
          openai_api: mockBaseUrl,
          openrouter_api: mockBaseUrl,
          gemini_api: mockBaseUrl,
          anthropic_api: mockBaseUrl,
        },
        ollamaBaseUrl: mockBaseUrl,
      },
    );

    cleanups.push(async () => {
      await supervisor.shutdown();
      await mcpManager.shutdown();
      db.close();
      tmp.cleanup();
    });

    return {
      tmp,
      companyStore,
      runsRepo,
      approvalsRepo,
      auditRepo,
      usageRepo,
      vault,
      supervisor,
    };
  }

  it("executes DirectApiAdapter tool-calling loops, pauses Tier 3 tools in WAITING_APPROVAL, and streams Ollama at $0 cost", async () => {
    const mockHttp = await startMockProviderHttpServer();
    cleanups.push(() => mockHttp.close());
    const h = setupDirectSupervisor(mockHttp.baseUrl);

    // 1. Missing API key -> structured AUTH_REQUIRED
    const missingAuthRun = h.supervisor.enqueueRun({
      employeeId: "product-strategist",
      prompt: "Analyze market",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const missingAuthDone = await waitForRun(h.runsRepo, missingAuthRun.id);
    expect(missingAuthDone.status).toBe("FAILED");
    expect(missingAuthDone.errorCode).toBe("AUTH_REQUIRED");

    // 2. Save keys in Encrypted Vault -> execute multi-turn tool-calling loop
    h.vault.setSecret("OPENAI_API_KEY", "sk-test-valid-openai-key");
    h.vault.setSecret("GEMINI_API_KEY", "AIzaSyTestValidGeminiKey123456");
    h.vault.setSecret("ANTHROPIC_API_KEY", "sk-ant-test-valid-anthropic");

    mockHttp.setOpenaiMode("tool_loop");
    const toolLoopRun = h.supervisor.enqueueRun({
      employeeId: "product-strategist",
      prompt: "راجع مبادئ التشغيل",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const toolLoopDone = await waitForRun(h.runsRepo, toolLoopRun.id);
    expect(toolLoopDone.status).toBe("COMPLETED");
    expect(toolLoopDone.finalOutput).toContain("مبادئ التشغيل");
    expect(toolLoopDone.inputTokens).toBe(320);
    expect(toolLoopDone.costUsd).toBeGreaterThan(0);

    // 3. Tier 3 tool call (`github_create_issue`) pauses in WAITING_APPROVAL
    mockHttp.setOpenaiMode("tier3");
    const tier3Run = h.supervisor.enqueueRun({
      employeeId: "senior-engineer",
      prompt: "Create GitHub issue",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const tier3Done = await waitForRun(h.runsRepo, tier3Run.id);
    expect(tier3Done.status).toBe("WAITING_APPROVAL");
    expect(h.approvalsRepo.list("PENDING").some((a) => a.actionType === "github_create_issue")).toBe(
      true,
    );

    // 4. Anthropic & Ollama adapters
    const anthRun = h.supervisor.enqueueRun({
      employeeId: "growth-marketer",
      prompt: "Draft copy",
      mode: "live",
      providerOverride: "anthropic_api",
      modelOverride: "claude-sonnet-4-5",
    });
    const anthDone = await waitForRun(h.runsRepo, anthRun.id);
    expect(anthDone.status).toBe("COMPLETED");
    expect(anthDone.finalOutput).toBe("ANTHROPIC_OK");

    const ollamaRun = h.supervisor.enqueueRun({
      employeeId: "hr-talent",
      prompt: "Summarize locally",
      mode: "live",
      providerOverride: "ollama",
      modelOverride: "qwen2.5:7b",
    });
    const ollamaDone = await waitForRun(h.runsRepo, ollamaRun.id);
    expect(ollamaDone.status).toBe("COMPLETED");
    expect(ollamaDone.finalOutput).toBe("OLLAMA_LOCAL_OK");
    expect(ollamaDone.costUsd).toBe(0);
  });

  it("enforces Safe Fallback Policy: blocks paid fallback when allowPaidFallback=false, allows when enabled, and never retries AUTH_REQUIRED", async () => {
    const mockHttp = await startMockProviderHttpServer();
    cleanups.push(() => mockHttp.close());
    const h = setupDirectSupervisor(mockHttp.baseUrl);

    h.vault.setSecret("OPENAI_API_KEY", "sk-test-valid-openai-key");
    h.vault.setSecret("GEMINI_API_KEY", "AIzaSyTestValidGeminiKey123456");

    // Configure product-strategist with fallbackProvider: gemini_api
    const profPath = path.join(h.tmp.companyRoot, "employees", "product-strategist", "profile.yaml");
    const profYaml = fs
      .readFileSync(profPath, "utf8")
      .replace("fallbackProvider: codex", "fallbackProvider: gemini_api")
      .replace("fallbackModel: gpt-5.6-luna", "fallbackModel: gemini-2.5-flash");
    fs.writeFileSync(profPath, profYaml, "utf8");
    h.companyStore.reloadAll();

    // 1. RATE_LIMITED with allowPaidFallback = false -> must NOT auto-switch to paid Gemini API
    mockHttp.setOpenaiMode("rate_limit");
    const blockedFallbackRun = h.supervisor.enqueueRun({
      employeeId: "product-strategist",
      prompt: "Try rate-limited call",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const blockedDone = await waitForRun(h.runsRepo, blockedFallbackRun.id);
    expect(blockedDone.status).toBe("FAILED");
    expect(blockedDone.errorCode).toBe("RATE_LIMITED");

    // 2. Enable allowPaidFallback = true -> transient RATE_LIMITED triggers fallback ONCE to Gemini
    h.companyStore.updateCompanyPolicies({ budgets: { allowPaidFallback: true } });
    mockHttp.setOpenaiMode("rate_limit");
    const allowedFallbackRun = h.supervisor.enqueueRun({
      employeeId: "product-strategist",
      prompt: "Retry with fallback allowed",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const allowedDone = await waitForRun(h.runsRepo, allowedFallbackRun.id);
    expect(allowedDone.status).toBe("COMPLETED");
    expect(allowedDone.finalOutput).toBe("GEMINI_FALLBACK_OK");
    expect(h.auditRepo.listRecent(10).some((a) => a.action === "run.fallback_triggered")).toBe(true);

    // 3. AUTH_REQUIRED must NEVER trigger fallback even when allowPaidFallback = true
    mockHttp.setOpenaiMode("auth_error");
    const authRun = h.supervisor.enqueueRun({
      employeeId: "product-strategist",
      prompt: "Invalid key test",
      mode: "live",
      providerOverride: "openai_api",
      modelOverride: "gpt-4.1",
    });
    const authDone = await waitForRun(h.runsRepo, authRun.id);
    expect(authDone.status).toBe("FAILED");
    expect(authDone.errorCode).toBe("AUTH_REQUIRED");
  });
});
