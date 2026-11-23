import { EventEmitter } from "node:events";
import {
  TelegramPolicySchema,
  redactSecrets,
  type ApprovalDecisionInput,
  type ApprovalRequest,
  type RunMode,
  type TelegramPolicy,
  type TelegramStatus,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { ApprovalsRepository } from "../db/repositories/approvals-repo.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";
import type { RunsRepository } from "../db/repositories/runs-repo.js";
import type { TelegramRepository } from "../db/repositories/telegram-repo.js";
import type { UsageRepository } from "../db/repositories/usage-repo.js";
import type { ApprovalDecideResult, ApprovalEngine } from "../governance/approval-engine.js";
import type { CredentialVault } from "../governance/vault.js";
import type { JobSupervisor } from "../runtime/job-supervisor.js";

export interface TelegramUpdatePayload {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id: number | string; type?: string };
    from?: { id: number | string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number | string; username?: string };
    message?: { chat?: { id: number | string }; message_id?: number };
    data?: string;
  };
}

export type SharedApprovalDecider = (
  id: string,
  input: ApprovalDecisionInput,
) => Promise<ApprovalDecideResult>;

export class TelegramBridge {
  public readonly bus = new EventEmitter();
  private readonly apiBaseUrl: string;
  private readonly enablePolling: boolean;
  private readonly defaultMode: RunMode;
  private pollingActive = false;
  private pollOffset = 0;
  private botUsername: string | null = null;
  private lastError: string | null = null;
  private pollAbort: AbortController | null = null;
  private closed = false;

  private readonly onApprovalCreatedHandler: (approval: ApprovalRequest) => void;
  private readonly onRunFinishedHandler: (payload: { runId: string }) => void;

  constructor(
    private readonly companyStore: CompanyStore,
    private readonly vault: CredentialVault,
    private readonly telegramRepo: TelegramRepository,
    private readonly runsRepo: RunsRepository,
    private readonly approvalsRepo: ApprovalsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly usageRepo: UsageRepository,
    private readonly auditRepo: AuditRepository,
    private readonly supervisor: JobSupervisor,
    private readonly decideApproval: SharedApprovalDecider,
    opts?: { apiBaseUrl?: string; enablePolling?: boolean; defaultMode?: RunMode },
  ) {
    this.apiBaseUrl = (opts?.apiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.enablePolling = opts?.enablePolling ?? false;
    this.defaultMode = opts?.defaultMode ?? "live";

    this.onApprovalCreatedHandler = (approval) => {
      if (this.closed) return;
      const policy = this.getPolicy();
      if (!policy.enabled || !policy.notifyApprovals || policy.allowedChatIds.length === 0) {
        return;
      }
      const empName =
        this.companyStore.getEmployee(approval.employeeId)?.profile.nameAr ?? approval.employeeId;
      const taintNote = approval.taintedByExternalInput ? "\n⚠️ يحتوي بيانات خارجية غير موثوقة" : "";
      const text = [
        `🛡️ طلب موافقة Tier 3`,
        `الموظف: ${empName} (${approval.employeeId})`,
        `العنوان: ${approval.title}`,
        `الإجراء: ${approval.actionType}`,
        `الملخص: ${approval.summary.slice(0, 260)}${taintNote}`,
      ].join("\n");

      const keyboard = [
        [
          { text: "✅ الموافقة والتنفيذ", callback_data: `appr:approve:${approval.id}` },
          { text: "❌ رفض", callback_data: `appr:reject:${approval.id}` },
        ],
      ];

      for (const chatId of policy.allowedChatIds) {
        void this.sendOutboundMessage(chatId, text, {
          inlineKeyboard: keyboard,
          linkedApprovalId: approval.id,
        });
      }
    };

    this.onRunFinishedHandler = ({ runId }) => {
      if (this.closed) return;
      const policy = this.getPolicy();
      if (!policy.enabled || !policy.notifyRunCompletion) return;
      const chatId = this.telegramRepo.findInboundRunChatId(runId);
      if (!chatId) return;

      const run = this.runsRepo.getById(runId);
      if (!run) return;
      const empName =
        this.companyStore.getEmployee(run.employeeId)?.profile.nameAr ?? run.employeeId;

      if (run.status === "WAITING_APPROVAL") {
        // Approval push handles notifications cleanly when notifyApprovals is enabled
        return;
      }

      const body = redactSecrets(
        run.finalOutput || run.errorMessage || `Status: ${run.status}`,
      ).slice(0, 1200);
      const reply = `📌 [${empName}] (${run.status})\n${body}`;
      void this.sendOutboundMessage(chatId, reply, { linkedRunId: run.id });
    };

    this.approvalEngine.bus.on("approval_created", this.onApprovalCreatedHandler);
    this.supervisor.bus.on("run_finished", this.onRunFinishedHandler);

    if (this.enablePolling) {
      this.refreshPolling();
    }
  }

  public getPolicy(): TelegramPolicy {
    return this.companyStore.getCompanyConfig().telegram ?? TelegramPolicySchema.parse({});
  }

  public getStatus(): TelegramStatus {
    const policy = this.getPolicy();
    const hasToken = Boolean(this.vault.resolveSecret("TELEGRAM_BOT_TOKEN"));
    return {
      enabled: policy.enabled,
      hasToken,
      pollingActive: this.pollingActive,
      allowedChatCount: policy.allowedChatIds.length,
      defaultEmployeeId: policy.defaultEmployeeId,
      botUsername: this.botUsername,
      lastError: this.lastError,
    };
  }

  public refreshPolling(): void {
    this.stopPolling();
    if (this.closed || !this.enablePolling) return;

    const policy = this.getPolicy();
    const token = this.vault.resolveSecret("TELEGRAM_BOT_TOKEN");
    if (!policy.enabled || !token) return;

    this.pollingActive = true;
    const ac = new AbortController();
    this.pollAbort = ac;
    void this.pollLoop(ac.signal);
  }

  public stopPolling(): void {
    this.pollingActive = false;
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  public shutdown(): void {
    this.closed = true;
    this.stopPolling();
    this.approvalEngine.bus.off("approval_created", this.onApprovalCreatedHandler);
    this.supervisor.bus.off("run_finished", this.onRunFinishedHandler);
  }

  public async testConnection(): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
    const token = this.vault.resolveSecret("TELEGRAM_BOT_TOKEN");
    if (!token) {
      return { ok: false, error: "TELEGRAM_BOT_TOKEN is not saved in the Encrypted Vault." };
    }
    try {
      const resp = await fetch(`${this.apiBaseUrl}/bot${token}/getMe`, {
        signal: AbortSignal.timeout(5_000),
      });
      const json = (await resp.json()) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      };
      if (!resp.ok || !json.ok) {
        const msg = json.description ?? `HTTP ${resp.status}`;
        this.lastError = msg;
        return { ok: false, error: msg };
      }
      this.botUsername = json.result?.username ?? null;
      this.lastError = null;
      return { ok: true, botUsername: this.botUsername ?? undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return { ok: false, error: msg };
    }
  }

  public async simulateInbound(input: {
    chatId: string;
    text?: string;
    callbackData?: string;
    mode?: RunMode;
  }): Promise<{ accepted: boolean; reply?: string; error?: string }> {
    if (input.callbackData) {
      return this.processUpdate(
        {
          callback_query: {
            id: `sim-cb-${Date.now()}`,
            message: { chat: { id: input.chatId }, message_id: 1 },
            data: input.callbackData,
          },
        },
        { mode: input.mode },
      );
    }
    return this.processUpdate(
      {
        message: {
          message_id: Date.now(),
          chat: { id: input.chatId, type: "private" },
          text: input.text ?? "/status",
        },
      },
      { mode: input.mode },
    );
  }

  private logInbound(chatId: string, text: string, linkedRunId?: string | null): void {
    const saved = this.telegramRepo.logMessage({
      chatId,
      direction: "inbound",
      text: redactSecrets(text),
      linkedRunId: linkedRunId ?? null,
    });
    this.bus.emit("telegram_message", saved);
  }

  public async processUpdate(
    update: TelegramUpdatePayload,
    opts?: { mode?: RunMode },
  ): Promise<{ accepted: boolean; reply?: string; error?: string }> {
    const policy = this.getPolicy();

    // 1. Inline Approval Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id !== undefined ? String(cb.message.chat.id) : "";
      if (!chatId || !policy.allowedChatIds.includes(chatId)) {
        this.logUnauthorized(chatId || "unknown", cb.data ?? "callback");
        await this.answerCallbackQuery(cb.id, "Unauthorized chat ID");
        return { accepted: false, error: "Unauthorized chat ID" };
      }

      const data = cb.data ?? "";
      this.logInbound(chatId, `[callback] ${data}`);

      const match = /^appr:(approve|reject):(.+)$/.exec(data);
      if (!match) {
        await this.answerCallbackQuery(cb.id, "Unknown action");
        return { accepted: false, error: "Unsupported callback action" };
      }

      const decision = match[1] === "approve" ? "APPROVED" : "REJECTED";
      const approvalId = match[2]!;
      const result = await this.decideApproval(approvalId, {
        decision,
        note: "Decided via Telegram mobile bridge",
      });

      const reply =
        result.status === "EXECUTED"
          ? `✅ تمت الموافقة وتنفيذ الطلب (${approvalId.slice(0, 8)}).`
          : result.status === "REJECTED"
            ? `❌ تم رفض الطلب (${approvalId.slice(0, 8)}).`
            : `⚠️ تعذّر تنفيذ الطلب (${result.status})${"reason" in result ? `: ${result.reason}` : ""}`;

      await this.answerCallbackQuery(cb.id, result.status);
      await this.sendOutboundMessage(chatId, reply, { linkedApprovalId: approvalId });
      return { accepted: result.status === "EXECUTED" || result.status === "REJECTED", reply };
    }

    // 2. Text Message / Command
    const msg = update.message;
    if (!msg?.chat?.id || typeof msg.text !== "string") {
      return { accepted: false, error: "Empty or non-text update" };
    }

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    if (!text) {
      return { accepted: false, error: "Blank text" };
    }

    // Strict fail-closed allowlist guard
    if (!policy.allowedChatIds.includes(chatId)) {
      this.logUnauthorized(chatId, text);
      return { accepted: false, error: `Chat ID "${chatId}" is not in allowedChatIds.` };
    }

    if (/^\/status(?:@\S+)?(?:\s|$)/i.test(text)) {
      this.logInbound(chatId, text);
      const usage = this.usageRepo.getSummary();
      const pending = this.approvalsRepo.list("PENDING").length;
      const activeRuns = this.supervisor.getActiveCount();
      const empCount = this.companyStore.listEmployees().length;
      const reply = [
        `📊 حالة المكتب الافتراضي`,
        `• الموظفون: ${empCount}`,
        `• مهام تعمل الآن: ${activeRuns}`,
        `• موافقات بانتظارك: ${pending}`,
        `• إنفاق اليوم الفعلي: $${usage.liveTodayUsd.toFixed(4)}`,
      ].join("\n");
      await this.sendOutboundMessage(chatId, reply);
      return { accepted: true, reply };
    }

    if (/^\/team(?:@\S+)?(?:\s|$)/i.test(text)) {
      this.logInbound(chatId, text);
      const lines = this.companyStore
        .listEmployees()
        .map((e) => `• @${e.profile.id} — ${e.profile.nameAr} (${e.profile.roleAr})`);
      const reply = `👥 فريق العمل:\n${lines.join("\n")}`;
      await this.sendOutboundMessage(chatId, reply);
      return { accepted: true, reply };
    }

    if (/^\/approvals(?:@\S+)?(?:\s|$)/i.test(text)) {
      this.logInbound(chatId, text);
      const pending = this.approvalsRepo.list("PENDING");
      if (pending.length === 0) {
        const reply = "✅ لا توجد طلبات موافقة معلّقة حالياً.";
        await this.sendOutboundMessage(chatId, reply);
        return { accepted: true, reply };
      }
      for (const a of pending.slice(0, 5)) {
        await this.sendOutboundMessage(
          chatId,
          `🛡️ [${a.employeeId}] ${a.title}\n${a.summary}`,
          {
            linkedApprovalId: a.id,
            inlineKeyboard: [
              [
                { text: "✅ موافقة", callback_data: `appr:approve:${a.id}` },
                { text: "❌ رفض", callback_data: `appr:reject:${a.id}` },
              ],
            ],
          },
        );
      }
      return { accepted: true, reply: `Sent ${Math.min(pending.length, 5)} pending approvals.` };
    }

    let targetEmpId = policy.defaultEmployeeId;
    let promptText = text;

    const askMatch = /^\/ask(?:@\S+)?\s+([a-z0-9_-]+)\s+([\s\S]+)$/i.exec(text);
    const atMatch = /^@([a-z0-9_-]+)\s+([\s\S]+)$/i.exec(text);
    if (askMatch) {
      targetEmpId = askMatch[1]!;
      promptText = askMatch[2]!.trim();
    } else if (atMatch) {
      targetEmpId = atMatch[1]!;
      promptText = atMatch[2]!.trim();
    } else if (text.startsWith("/")) {
      this.logInbound(chatId, text);
      const reply =
        "الأوامر المتاحة:\n/status — حالة المكتب\n/team — قائمة الموظفين\n/approvals — الموافقات المعلّقة\n/ask <employeeId> <المهمة> أو @<employeeId> <المهمة>";
      await this.sendOutboundMessage(chatId, reply);
      return { accepted: true, reply };
    }

    const employee = this.companyStore.getEmployee(targetEmpId);
    if (!employee) {
      this.logInbound(chatId, text);
      const reply = `⚠️ الموظف "${targetEmpId}" غير موجود. استخدم /team لعرض الفريق.`;
      await this.sendOutboundMessage(chatId, reply);
      return { accepted: false, reply, error: reply };
    }

    const mode: RunMode = opts?.mode ?? this.defaultMode;

    const run = this.supervisor.enqueueRun({
      employeeId: targetEmpId,
      prompt: `[Telegram Mobile Input]\n${promptText}`,
      mode,
      riskTier: "tier1_auto",
    });

    this.logInbound(chatId, text, run.id);

    const ack =
      run.status === "BUDGET_EXCEEDED"
        ? `⛔ توقف الإرسال بسبب الميزانية: ${run.errorMessage}`
        : `⏳ استلم ${employee.profile.nameAr} مهمتك (Run ${run.id.slice(0, 8)}).`;
    await this.sendOutboundMessage(chatId, ack, { linkedRunId: run.id });

    return { accepted: true, reply: ack };
  }

  private async sendOutboundMessage(
    chatId: string,
    text: string,
    opts?: {
      inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
      linkedRunId?: string | null;
      linkedApprovalId?: string | null;
    },
  ): Promise<void> {
    const safeText = redactSecrets(text);
    const saved = this.telegramRepo.logMessage({
      chatId,
      direction: "outbound",
      text: safeText,
      linkedRunId: opts?.linkedRunId ?? null,
      linkedApprovalId: opts?.linkedApprovalId ?? null,
    });
    this.bus.emit("telegram_message", saved);

    const token = this.vault.resolveSecret("TELEGRAM_BOT_TOKEN");
    if (!token) return;

    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: safeText,
      };
      if (opts?.inlineKeyboard) {
        payload.reply_markup = { inline_keyboard: opts.inlineKeyboard };
      }
      const resp = await fetch(`${this.apiBaseUrl}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        this.lastError = `Telegram sendMessage HTTP ${resp.status}`;
      } else {
        this.lastError = null;
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  private async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    const token = this.vault.resolveSecret("TELEGRAM_BOT_TOKEN");
    if (!token) return;
    try {
      await fetch(`${this.apiBaseUrl}/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      });
    } catch {
      // Best-effort answer
    }
  }

  private logUnauthorized(chatId: string, text: string): void {
    this.auditRepo.log({
      actorType: "system",
      actorId: "telegram-bridge",
      action: "telegram.unauthorized_chat",
      targetType: "telegram_chat",
      targetId: chatId,
      status: "DENIED",
      details: { preview: redactSecrets(text).slice(0, 120) },
    });
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.closed && this.pollingActive) {
      const policy = this.getPolicy();
      const token = this.vault.resolveSecret("TELEGRAM_BOT_TOKEN");
      if (!policy.enabled || !token) {
        this.pollingActive = false;
        return;
      }

      try {
        const resp = await fetch(
          `${this.apiBaseUrl}/bot${token}/getUpdates?offset=${this.pollOffset}&timeout=10`,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) },
        );
        if (resp.ok) {
          const data = (await resp.json()) as {
            ok?: boolean;
            result?: TelegramUpdatePayload[];
          };
          this.lastError = null;
          if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
              if (typeof upd.update_id === "number") {
                this.pollOffset = Math.max(this.pollOffset, upd.update_id + 1);
              }
              await this.processUpdate(upd);
            }
          }
        } else {
          this.lastError = `Telegram getUpdates HTTP ${resp.status}`;
        }
      } catch (err) {
        if (signal.aborted) return;
        this.lastError = err instanceof Error ? err.message : String(err);
      }

      await new Promise((resolve) => {
        const t = setTimeout(resolve, policy.pollIntervalMs);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve(undefined);
        }, { once: true });
      });
    }
  }
}
