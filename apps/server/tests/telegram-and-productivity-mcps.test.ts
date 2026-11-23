import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

interface RecordedBotCall {
  method: string;
  body?: Record<string, unknown>;
}

async function waitFor<T>(
  check: () => T | undefined | null | false,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = check();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe("Phase 5 Bidirectional Telegram Bridge & Productivity MCP Templates", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function startMockTelegramApi(): Promise<{
    baseUrl: string;
    calls: RecordedBotCall[];
  }> {
    const calls: RecordedBotCall[] = [];
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        const url = req.url ?? "";
        const methodName = url.split("/").pop()?.split("?")[0] ?? "unknown";
        calls.push({ method: methodName, body });

        res.setHeader("Content-Type", "application/json");
        if (methodName === "getMe") {
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                id: 987654321,
                is_bot: true,
                first_name: "Founder Office Bot",
                username: "virtual_office_test_bot",
              },
            }),
          );
          return;
        }
        if (methodName === "sendMessage") {
          res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
          return;
        }
        if (methodName === "answerCallbackQuery") {
          res.end(JSON.stringify({ ok: true, result: true }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, description: "Unknown mock endpoint" }));
      });
    });

    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const addr = srv.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          srv.close(() => resolve());
        }),
    );

    return { baseUrl: `http://127.0.0.1:${port}`, calls };
  }

  async function bootServer(
    telegramApiBaseUrl: string,
  ): Promise<{ ctx: OfficeAppContext; baseUrl: string }> {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      enableAutomationPollers: false,
      telegramApiBaseUrl,
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

  it("enforces Encrypted Vault token storage, fail-closed allowlist, bidirectional commands, and idempotent Tier 3 approval callbacks", async () => {
    const mockTg = await startMockTelegramApi();
    const { ctx, baseUrl } = await bootServer(mockTg.baseUrl);
    const headers = {
      Authorization: `Bearer ${ctx.auth.sessionToken}`,
      "Content-Type": "application/json",
    };

    // 1. Store TELEGRAM_BOT_TOKEN in Vault -> verify masked -> verify getMe
    const rawBotToken = "123456:TEST_BOT_TOKEN_SECRET_XYZ";
    const putKeyResp = await fetch(`${baseUrl}/api/vault/keys/TELEGRAM_BOT_TOKEN`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: rawBotToken, providerHint: "telegram" }),
    });
    expect(putKeyResp.status).toBe(200);

    const vaultKeysBody = (await (
      await fetch(`${baseUrl}/api/vault/keys`, {
        headers: { Authorization: headers.Authorization },
      })
    ).json()) as { keys: Array<{ key: string; maskedValue: string }> };
    const tgKey = vaultKeysBody.keys.find((k) => k.key === "TELEGRAM_BOT_TOKEN");
    expect(tgKey).toBeTruthy();
    expect(tgKey!.maskedValue).not.toContain("SECRET_XYZ");

    const testResp = await fetch(`${baseUrl}/api/telegram/test`, {
      method: "POST",
      headers: { Authorization: headers.Authorization },
    });
    expect(testResp.status).toBe(200);
    const testBody = (await testResp.json()) as {
      result: { ok: boolean; botUsername?: string };
      status: { hasToken: boolean };
    };
    expect(testBody.result.ok).toBe(true);
    expect(testBody.result.botUsername).toBe("virtual_office_test_bot");
    expect(testBody.status.hasToken).toBe(true);

    // 2. Enable fail-closed Telegram policy with allowlisted chatId 555001
    const policyResp = await fetch(`${baseUrl}/api/company/policies`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        telegram: {
          enabled: true,
          allowedChatIds: ["555001"],
          notifyApprovals: true,
          notifyRunCompletion: true,
        },
      }),
    });
    expect(policyResp.status).toBe(200);

    // 3. Unauthorized chat ID must be rejected + audited
    const unauthResp = await fetch(`${baseUrl}/api/telegram/simulate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ chatId: "999999", text: "/status", mode: "mock" }),
    });
    expect(unauthResp.status).toBe(200);
    const unauthBody = (await unauthResp.json()) as { accepted: boolean; error?: string };
    expect(unauthBody.accepted).toBe(false);
    expect(unauthBody.error).toContain("999999");

    const auditBody = (await (
      await fetch(`${baseUrl}/api/audit?limit=50`, {
        headers: { Authorization: headers.Authorization },
      })
    ).json()) as { logs: Array<{ action: string; targetId?: string; status: string }> };
    expect(
      auditBody.logs.some(
        (l) =>
          l.action === "telegram.unauthorized_chat" &&
          l.targetId === "999999" &&
          l.status === "DENIED",
      ),
    ).toBe(true);

    // 4. Authorized /status & /team commands reply via mock sendMessage
    const statusCmd = await (
      await fetch(`${baseUrl}/api/telegram/simulate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatId: "555001", text: "/status", mode: "mock" }),
      })
    ).json() as { accepted: boolean; reply?: string };
    expect(statusCmd.accepted).toBe(true);
    expect(statusCmd.reply).toContain("حالة المكتب الافتراضي");

    const teamCmd = await (
      await fetch(`${baseUrl}/api/telegram/simulate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatId: "555001", text: "/team", mode: "mock" }),
      })
    ).json() as { accepted: boolean; reply?: string };
    expect(teamCmd.accepted).toBe(true);
    expect(teamCmd.reply).toContain("@senior-engineer");

    // 5. Mention command dispatches mock run & pushes completion message on finish
    const sendCountBefore = mockTg.calls.filter((c) => c.method === "sendMessage").length;
    const mentionResp = (await (
      await fetch(`${baseUrl}/api/telegram/simulate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          chatId: "555001",
          text: "@senior-engineer Quick health check",
          mode: "mock",
        }),
      })
    ).json()) as { accepted: boolean; reply?: string };
    expect(mentionResp.accepted).toBe(true);

    await waitFor(() => {
      const sends = mockTg.calls.filter((c) => c.method === "sendMessage").slice(sendCountBefore);
      return sends.some(
        (c) => typeof c.body?.text === "string" && c.body.text.includes("COMPLETED"),
      );
    });

    // 6. Trigger Tier 3 Approval (QA hiring proposal) -> outbound inline keyboard -> idempotent replay protection
    const tplResp = await fetch(`${baseUrl}/api/hiring/templates`, {
      headers: { Authorization: headers.Authorization },
    });
    const { templates } = (await tplResp.json()) as {
      templates: Array<{ id: string; defaults: Record<string, unknown> }>;
    };
    const qaTemplate = templates.find((t) => t.id === "qa-engineer");
    expect(qaTemplate).toBeTruthy();

    const hireResp = await fetch(`${baseUrl}/api/hiring/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(qaTemplate!.defaults),
    });
    expect(hireResp.status).toBe(201);
    const { approval } = (await hireResp.json()) as { approval: { id: string } };

    const approvalMsg = await waitFor(() =>
      mockTg.calls.find(
        (c) =>
          c.method === "sendMessage" &&
          JSON.stringify(c.body?.reply_markup ?? {}).includes(`appr:approve:${approval.id}`),
      ),
    );
    expect(JSON.stringify(approvalMsg.body?.reply_markup)).toContain(`appr:reject:${approval.id}`);

    // First Telegram inline approve callback executes provisioning
    const cb1 = (await (
      await fetch(`${baseUrl}/api/telegram/simulate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          chatId: "555001",
          callbackData: `appr:approve:${approval.id}`,
        }),
      })
    ).json()) as { accepted: boolean; reply?: string };
    expect(cb1.accepted).toBe(true);

    const empList = (await (
      await fetch(`${baseUrl}/api/employees`, {
        headers: { Authorization: headers.Authorization },
      })
    ).json()) as { employees: Array<{ profile: { id: string } }> };
    expect(empList.employees.some((e) => e.profile.id === "qa-engineer")).toBe(true);

    // Replay same callback -> blocked idempotently without double execution
    const cb2 = (await (
      await fetch(`${baseUrl}/api/telegram/simulate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          chatId: "555001",
          callbackData: `appr:approve:${approval.id}`,
        }),
      })
    ).json()) as { accepted: boolean; reply?: string };
    expect(cb2.accepted).toBe(false);
    expect(mockTg.calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
  });

  it("exposes least-privilege google-workspace, notion, and slack MCP templates with Tier 3 external write overrides", async () => {
    const mockTg = await startMockTelegramApi();
    const { ctx, baseUrl } = await bootServer(mockTg.baseUrl);
    const headers = { Authorization: `Bearer ${ctx.auth.sessionToken}` };

    const resp = await fetch(`${baseUrl}/api/mcps/templates`, { headers });
    expect(resp.status).toBe(200);
    const { templates } = (await resp.json()) as {
      templates: Array<{
        id: string;
        config: {
          enabled: boolean;
          defaultRiskTier: string;
          toolRiskOverrides?: Record<string, string>;
        };
      }>;
    };

    const gws = templates.find((t) => t.id === "google-workspace");
    const notion = templates.find((t) => t.id === "notion");
    const slack = templates.find((t) => t.id === "slack");

    expect(gws).toBeTruthy();
    expect(notion).toBeTruthy();
    expect(slack).toBeTruthy();

    for (const tpl of [gws!, notion!, slack!]) {
      expect(tpl.config.enabled).toBe(false);
      expect(tpl.config.defaultRiskTier).toBe("tier1_auto");
    }

    expect(gws!.config.toolRiskOverrides).toMatchObject({
      send_email: "tier3_approval",
      create_calendar_event: "tier3_approval",
      delete_file: "tier3_approval",
      share_file: "tier3_approval",
    });
    expect(notion!.config.toolRiskOverrides).toMatchObject({
      create_page: "tier3_approval",
      update_page: "tier3_approval",
      delete_block: "tier3_approval",
    });
    expect(slack!.config.toolRiskOverrides).toMatchObject({
      post_message: "tier3_approval",
      reply_to_thread: "tier3_approval",
    });
  });
});
