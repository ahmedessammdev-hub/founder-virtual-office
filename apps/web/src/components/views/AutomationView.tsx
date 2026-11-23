import React, { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  KeyRound,
  MessageSquare,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";
import type { RiskTier, RunMode, ScheduledJob } from "@virtual-office/shared";
import { useVoiceInput } from "../../hooks/useVoiceInput.ts";
import { useOfficeStore } from "../../store/office-store.ts";

type AutomationTab = "cron" | "telegram";

function formatShortTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AutomationView() {
  const {
    locale,
    employees,
    projects,
    runMode,
    scheduledJobs,
    scheduledJobRuns,
    cronPresets,
    telegramStatus,
    telegramMessages,
    vaultKeys,
    companyPolicies,
    loadAutomation,
    createScheduledJob,
    updateScheduledJob,
    deleteScheduledJob,
    runScheduledJobNow,
    saveVaultKey,
    deleteVaultKey,
    updatePolicies,
    testTelegramBot,
    simulateTelegramUpdate,
  } = useOfficeStore();

  const [activeTab, setActiveTab] = useState<AutomationTab>("cron");

  // --- Cron creation form state ---
  const [jobName, setJobName] = useState("Daily Tech Pulse");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [jobEmployeeId, setJobEmployeeId] = useState("general-manager");
  const [jobProjectId, setJobProjectId] = useState("");
  const [jobMode, setJobMode] = useState<RunMode>(runMode);
  const [jobRiskTier, setJobRiskTier] = useState<Extract<RiskTier, "tier1_auto" | "tier2_guarded">>(
    "tier1_auto",
  );
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(6);
  const [jobPrompt, setJobPrompt] = useState(
    "Summarize active office status, open blockers, and today's priorities concisely.",
  );
  const [jobEnabled, setJobEnabled] = useState(true);
  const [creatingJob, setCreatingJob] = useState(false);
  const [cronBanner, setCronBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  // Voice dictation for Cron prompt
  const voiceCron = useVoiceInput(
    (transcript) =>
      setJobPrompt((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript)),
    locale === "ar" ? "ar-EG" : "en-US",
  );

  // --- Telegram vault + policy + simulator state ---
  const existingBotKey = vaultKeys.find((k) => k.key === "TELEGRAM_BOT_TOKEN");
  const [botTokenInput, setBotTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [testingBot, setTestingBot] = useState(false);

  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgAllowedChatsText, setTgAllowedChatsText] = useState("");
  const [tgDefaultEmpId, setTgDefaultEmpId] = useState("general-manager");
  const [tgNotifyApprovals, setTgNotifyApprovals] = useState(true);
  const [tgNotifyRuns, setTgNotifyRuns] = useState(true);
  const [tgPollMs, setTgPollMs] = useState(4000);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [tgBanner, setTgBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const [simChatId, setSimChatId] = useState("10001");
  const [simText, setSimText] = useState("/status");
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    void loadAutomation();
  }, [loadAutomation]);

  useEffect(() => {
    setJobMode(runMode);
  }, [runMode]);

  useEffect(() => {
    const tg = companyPolicies?.telegram;
    if (!tg) return;
    setTgEnabled(tg.enabled);
    setTgAllowedChatsText(tg.allowedChatIds.join(", "));
    setTgDefaultEmpId(tg.defaultEmployeeId);
    setTgNotifyApprovals(tg.notifyApprovals);
    setTgNotifyRuns(tg.notifyRunCompletion);
    setTgPollMs(tg.pollIntervalMs);
  }, [companyPolicies?.telegram]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setCronBanner(null);
    setCreatingJob(true);
    try {
      const created = await createScheduledJob({
        name: jobName.trim(),
        cronExpression: cronExpression.trim(),
        employeeId: jobEmployeeId,
        projectId: jobProjectId ? jobProjectId : null,
        prompt: jobPrompt.trim(),
        mode: jobMode,
        riskTier: jobRiskTier,
        enabled: jobEnabled,
        maxRunsPerDay: Number(maxRunsPerDay) || 6,
      });
      setCronBanner({
        ok: true,
        text:
          locale === "ar"
            ? `تمت جدولة "${created.name}" (${created.cronExpression}) بنجاح.`
            : `Scheduled job "${created.name}" (${created.cronExpression}) created.`,
      });
    } catch (err) {
      setCronBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to create schedule",
      });
    } finally {
      setCreatingJob(false);
    }
  };

  const handleToggleJob = async (job: ScheduledJob) => {
    setBusyJobId(job.id);
    setCronBanner(null);
    try {
      await updateScheduledJob(job.id, { enabled: !job.enabled });
    } catch (err) {
      setCronBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to update job",
      });
    } finally {
      setBusyJobId(null);
    }
  };

  const handleRunNow = async (job: ScheduledJob) => {
    setBusyJobId(job.id);
    setCronBanner(null);
    try {
      const res = await runScheduledJobNow(job.id);
      setCronBanner({
        ok: res.triggered,
        text: res.triggered
          ? locale === "ar"
            ? `تم تشغيل "${job.name}" فوراً وإدراجه في سجل التنفيذ.`
            : `Triggered "${job.name}" immediately.`
          : res.reason ?? "Job could not be triggered",
      });
    } catch (err) {
      setCronBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Manual run failed",
      });
    } finally {
      setBusyJobId(null);
    }
  };

  const handleDeleteJob = async (job: ScheduledJob) => {
    setBusyJobId(job.id);
    setCronBanner(null);
    try {
      await deleteScheduledJob(job.id);
      setCronBanner({
        ok: true,
        text:
          locale === "ar"
            ? `تم حذف المهمة المجدولة "${job.name}".`
            : `Deleted scheduled job "${job.name}".`,
      });
    } catch (err) {
      setCronBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Delete failed",
      });
    } finally {
      setBusyJobId(null);
    }
  };

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botTokenInput.trim()) return;
    setSavingToken(true);
    setTgBanner(null);
    try {
      await saveVaultKey("TELEGRAM_BOT_TOKEN", botTokenInput.trim(), "telegram");
      setBotTokenInput("");
      await loadAutomation();
      setTgBanner({
        ok: true,
        text:
          locale === "ar"
            ? "تم حفظ TELEGRAM_BOT_TOKEN مشفراً في خزينة المفاتيح."
            : "Saved TELEGRAM_BOT_TOKEN encrypted in Vault.",
      });
    } catch (err) {
      setTgBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to save bot token",
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleRemoveToken = async () => {
    setSavingToken(true);
    setTgBanner(null);
    try {
      await deleteVaultKey("TELEGRAM_BOT_TOKEN");
      await loadAutomation();
      setTgBanner({
        ok: true,
        text: locale === "ar" ? "تم حذف توكن البوت من الخزينة." : "Removed bot token from Vault.",
      });
    } catch (err) {
      setTgBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to delete bot token",
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleTestBot = async () => {
    setTestingBot(true);
    setTgBanner(null);
    try {
      const res = await testTelegramBot();
      setTgBanner({
        ok: res.ok,
        text: res.ok
          ? locale === "ar"
            ? `اتصال البوت ناجح: @${res.botUsername ?? "bot"}`
            : `Bot verified via Telegram getMe: @${res.botUsername ?? "bot"}`
          : res.error ?? "Bot verification failed",
      });
    } catch (err) {
      setTgBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to test bot connection",
      });
    } finally {
      setTestingBot(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    setTgBanner(null);
    try {
      const parsedIds = tgAllowedChatsText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await updatePolicies({
        telegram: {
          enabled: tgEnabled,
          allowedChatIds: Array.from(new Set(parsedIds)),
          defaultEmployeeId: tgDefaultEmpId,
          notifyApprovals: tgNotifyApprovals,
          notifyRunCompletion: tgNotifyRuns,
          pollIntervalMs: Math.min(60_000, Math.max(1500, Number(tgPollMs) || 4000)),
        },
      });
      await loadAutomation();
      setTgBanner({
        ok: true,
        text:
          locale === "ar"
            ? "تم تحديث سياسة جسر Telegram بنجاح."
            : "Updated Telegram bridge policy.",
      });
    } catch (err) {
      setTgBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to update Telegram policy",
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simChatId.trim() || !simText.trim()) return;
    setSimulating(true);
    setTgBanner(null);
    try {
      const res = await simulateTelegramUpdate({
        chatId: simChatId.trim(),
        text: simText.trim(),
        mode: runMode,
      });
      setTgBanner({
        ok: res.accepted,
        text: res.accepted
          ? res.reply ?? "Simulated message processed."
          : res.error ?? "Message rejected by allowlist.",
      });
    } catch (err) {
      setTgBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Simulation failed",
      });
    } finally {
      setSimulating(false);
    }
  };

  const activeJobsCount = scheduledJobs.filter((j) => j.enabled).length;
  const employeeNameById = new Map(
    employees.map((e) => [
      e.profile.id,
      locale === "ar" ? `${e.profile.nameAr} (${e.profile.id})` : `${e.profile.name} (${e.profile.id})`,
    ]),
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {locale === "ar"
              ? "الأتمتة المجدولة وجسر Telegram"
              : "Cron Automation & Bidirectional Telegram Bridge"}
          </h1>
          <p className="text-[13px] text-studio-muted">
            {locale === "ar"
              ? "جدولة مهام دورية بحدود يومية صارمة، وربط آمن لبوت تيليجرام لإرسال تنبيهات الموافقات واستلام الأوامر عن بُعد."
              : "Schedule recurring employee routines with daily caps and operate a fail-closed Telegram bot for remote directives & Tier 3 approvals."}
          </p>
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          <span
            dir="ltr"
            className="px-2.5 py-1 rounded border border-studio-border bg-studio-surface font-mono text-studio-ink"
          >
            Cron: {activeJobsCount}/{scheduledJobs.length}
          </span>
          <span
            dir="ltr"
            className={`px-2.5 py-1 rounded border font-mono ${
              telegramStatus?.pollingActive
                ? "border-studio-emerald/40 bg-studio-emerald-soft text-studio-emerald"
                : "border-studio-border bg-studio-surface text-studio-muted"
            }`}
          >
            TG: {telegramStatus?.enabled ? (telegramStatus.hasToken ? "armed" : "no-token") : "off"} · allow:{telegramStatus?.allowedChatCount ?? 0}
          </span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex p-1 rounded-lg border border-studio-border bg-studio-surface gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("cron")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
            activeTab === "cron"
              ? "bg-studio-subtle text-studio-ink"
              : "text-studio-muted hover:text-studio-ink"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{locale === "ar" ? "جدول المهام (Cron)" : "Cron Scheduler"}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("telegram")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
            activeTab === "telegram"
              ? "bg-studio-subtle text-studio-ink"
              : "text-studio-muted hover:text-studio-ink"
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>{locale === "ar" ? "جسر Telegram والمحاكي" : "Telegram Bridge & Simulator"}</span>
        </button>
      </div>

      {activeTab === "cron" ? (
        <div className="space-y-5">
          {cronBanner && (
            <div
              className={`px-3 py-2 rounded-md border text-[12.5px] flex items-center gap-2 ${
                cronBanner.ok
                  ? "border-studio-emerald/30 bg-studio-emerald-soft text-studio-emerald"
                  : "border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson"
              }`}
            >
              {cronBanner.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              )}
              <span dir="auto">{cronBanner.text}</span>
            </div>
          )}

          {/* Create Schedule Form */}
          <form
            onSubmit={handleCreateJob}
            className="rounded-lg border border-studio-border bg-studio-surface p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-studio-ink flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-studio-accent" />
                <span>{locale === "ar" ? "إنشاء مهمة مجدولة جديدة" : "Create Scheduled Job"}</span>
              </h2>

              {cronPresets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cronPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setCronExpression(preset.expression)}
                      className={`px-2 py-1 rounded border text-[11px] transition-colors ${
                        cronExpression.trim() === preset.expression
                          ? "border-studio-accent bg-studio-accent/10 text-studio-accent"
                          : "border-studio-border bg-studio-ground text-studio-muted hover:text-studio-ink"
                      }`}
                    >
                      <span>{locale === "ar" ? preset.labelAr : preset.label}</span>{" "}
                      <span dir="ltr" className="font-mono text-[10px] opacity-80">
                        ({preset.expression})
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "اسم المهمة" : "Schedule Name"}
                </span>
                <input
                  required
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  dir="auto"
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px] focus:outline-none focus:border-studio-accent"
                />
              </label>

              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "تعبير Cron (5 حقول)" : "Cron Expression (5-field)"}
                </span>
                <input
                  required
                  dir="ltr"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[13px] focus:outline-none focus:border-studio-accent"
                />
              </label>

              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "الموظف المنفذ" : "Assigned Employee"}
                </span>
                <select
                  value={jobEmployeeId}
                  onChange={(e) => setJobEmployeeId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px] focus:outline-none focus:border-studio-accent"
                >
                  {employees.map((emp) => (
                    <option key={emp.profile.id} value={emp.profile.id}>
                      {locale === "ar"
                        ? `${emp.profile.nameAr} — ${emp.profile.roleAr}`
                        : `${emp.profile.name} — ${emp.profile.role}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "المشروع (اختياري)" : "Project Scope"}
                </span>
                <select
                  value={jobProjectId}
                  onChange={(e) => setJobProjectId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px]"
                >
                  <option value="">{locale === "ar" ? "بدون مشروع محدد" : "Company-wide"}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "وضع التشغيل" : "Run Mode"}
                </span>
                <select
                  value={jobMode}
                  onChange={(e) => setJobMode(e.target.value as RunMode)}
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px]"
                >
                  <option value="mock">{locale === "ar" ? "اختبار Mock" : "Mock"}</option>
                  <option value="live">{locale === "ar" ? "مباشر Live" : "Live"}</option>
                </select>
              </label>

              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "مستوى المخاطرة" : "Max Risk Tier"}
                </span>
                <select
                  value={jobRiskTier}
                  onChange={(e) =>
                    setJobRiskTier(e.target.value as "tier1_auto" | "tier2_guarded")
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px]"
                >
                  <option value="tier1_auto">tier1_auto (Read/Report)</option>
                  <option value="tier2_guarded">tier2_guarded (Worktree)</option>
                </select>
              </label>

              <label className="space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar" ? "الحد الأقصى يومياً" : "Max Runs / Day"}
                </span>
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={maxRunsPerDay}
                  onChange={(e) => setMaxRunsPerDay(Number(e.target.value))}
                  dir="ltr"
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[13px]"
                />
              </label>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-studio-ink">
                  {locale === "ar" ? "التعليمات الدورية للموظف" : "Scheduled Task Prompt"}
                </span>
                <button
                  type="button"
                  disabled={!voiceCron.supported}
                  onClick={voiceCron.toggle}
                  title={
                    voiceCron.supported
                      ? locale === "ar"
                        ? "إملاء صوتي"
                        : "Voice Dictation"
                      : "SpeechRecognition unsupported in this browser"
                  }
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                    voiceCron.listening
                      ? "border-studio-crimson bg-studio-crimson-soft text-studio-crimson"
                      : "border-studio-border bg-studio-ground text-studio-muted hover:text-studio-ink disabled:opacity-45"
                  }`}
                >
                  {voiceCron.listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  <span>{voiceCron.listening ? "Recording…" : voiceCron.voiceLang}</span>
                </button>
              </div>
              <textarea
                required
                rows={2}
                value={jobPrompt}
                onChange={(e) => setJobPrompt(e.target.value)}
                dir="auto"
                className="w-full p-2.5 rounded border border-studio-border bg-studio-blueprint text-[13px] focus:outline-none focus:border-studio-accent"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-[12.5px] text-studio-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={jobEnabled}
                  onChange={(e) => setJobEnabled(e.target.checked)}
                />
                <span>{locale === "ar" ? "تفعيل الجدولة فوراً" : "Enable schedule immediately"}</span>
              </label>

              <button
                type="submit"
                disabled={creatingJob}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-studio-ink text-studio-ground text-[12.5px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {creatingJob
                    ? locale === "ar"
                      ? "جارٍ الحفظ…"
                      : "Creating…"
                    : locale === "ar"
                      ? "إضافة الجدولة"
                      : "Add Schedule"}
                </span>
              </button>
            </div>
          </form>

          {/* Scheduled Jobs List */}
          <section className="space-y-2.5">
            <h2 className="text-[13px] font-semibold text-studio-muted">
              {locale === "ar" ? "المهام المجدولة المسجلة" : "Registered Schedules"}
            </h2>
            {scheduledJobs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-studio-border bg-studio-surface p-6 text-center text-[13px] text-studio-muted">
                {locale === "ar"
                  ? "لا توجد مهام مجدولة بعد. أنشئ أول مهمة دورية من النموذج أعلاه."
                  : "No scheduled jobs yet. Create your first recurring job above."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {scheduledJobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-lg border border-studio-border bg-studio-surface p-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-studio-ink" dir="auto">
                          {job.name}
                        </span>
                        <span
                          dir="ltr"
                          className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px] text-studio-ink"
                        >
                          {job.cronExpression}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            job.enabled
                              ? "bg-studio-emerald-soft text-studio-emerald"
                              : "bg-studio-ground text-studio-muted"
                          }`}
                        >
                          {job.enabled ? (locale === "ar" ? "مفعّلة" : "Active") : locale === "ar" ? "متوقفة" : "Paused"}
                        </span>
                        <span dir="ltr" className="text-[11px] font-mono text-studio-muted">
                          {job.mode} · {job.riskTier}
                        </span>
                      </div>

                      <p className="text-[12.5px] text-studio-muted line-clamp-2" dir="auto">
                        {job.prompt}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-studio-muted">
                        <span>{employeeNameById.get(job.employeeId) ?? job.employeeId}</span>
                        <span dir="ltr" className="font-mono">
                          Today: {job.runsTodayCount}/{job.maxRunsPerDay}
                        </span>
                        <span dir="ltr" className="font-mono">
                          Next: {formatShortTime(job.nextRunAt)}
                        </span>
                        {job.lastRunStatus && (
                          <span dir="ltr" className="font-mono">
                            Last: {job.lastRunStatus} ({formatShortTime(job.lastRunAt)})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busyJobId === job.id}
                        onClick={() => void handleRunNow(job)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-studio-accent/40 bg-studio-accent/10 text-studio-accent text-[12px] font-medium hover:bg-studio-accent/15 disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>{locale === "ar" ? "تشغيل الآن" : "Run Now"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyJobId === job.id}
                        onClick={() => void handleToggleJob(job)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-studio-border bg-studio-ground text-studio-ink text-[12px] hover:border-studio-accent disabled:opacity-50"
                      >
                        {job.enabled ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>{locale === "ar" ? "إيقاف" : "Pause"}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>{locale === "ar" ? "تفعيل" : "Enable"}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={busyJobId === job.id}
                        onClick={() => void handleDeleteJob(job)}
                        aria-label={`Delete schedule ${job.name}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson text-[12px] hover:opacity-90 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{locale === "ar" ? "حذف" : "Delete"}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent Job Execution Log */}
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold text-studio-muted">
              {locale === "ar" ? "سجل تشغيل الجدولة الأخير" : "Recent Scheduled Execution Log"}
            </h2>
            <div className="rounded-lg border border-studio-border bg-studio-surface overflow-x-auto">
              {scheduledJobRuns.length === 0 ? (
                <div className="p-4 text-[12.5px] text-studio-muted">
                  {locale === "ar" ? "لا توجد عمليات تشغيل مسجلة حتى الآن." : "No schedule executions recorded yet."}
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="border-b border-studio-border bg-studio-ground/60 text-studio-muted">
                    <tr>
                      <th className="text-start px-3 py-2 font-medium">Trigger</th>
                      <th className="text-start px-3 py-2 font-medium">Job</th>
                      <th className="text-start px-3 py-2 font-medium">Status</th>
                      <th className="text-start px-3 py-2 font-medium">Summary</th>
                      <th className="text-start px-3 py-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-studio-border">
                    {scheduledJobRuns.slice(0, 20).map((rec) => {
                      const jobTitle =
                        scheduledJobs.find((j) => j.id === rec.jobId)?.name ?? rec.jobId;
                      return (
                        <tr key={rec.id}>
                          <td dir="ltr" className="px-3 py-2 font-mono">
                            {rec.triggerSource}
                          </td>
                          <td className="px-3 py-2 font-medium" dir="auto">
                            {jobTitle}
                          </td>
                          <td dir="ltr" className="px-3 py-2 font-mono">
                            {rec.status}
                          </td>
                          <td className="px-3 py-2 text-studio-muted max-w-md truncate" dir="auto">
                            {rec.summary ?? rec.runId ?? "—"}
                          </td>
                          <td dir="ltr" className="px-3 py-2 font-mono text-studio-muted">
                            {formatShortTime(rec.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* TELEGRAM TAB */
        <div className="space-y-5">
          {tgBanner && (
            <div
              className={`px-3 py-2 rounded-md border text-[12.5px] flex items-center gap-2 ${
                tgBanner.ok
                  ? "border-studio-emerald/30 bg-studio-emerald-soft text-studio-emerald"
                  : "border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson"
              }`}
            >
              {tgBanner.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              )}
              <span dir="auto">{tgBanner.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bot Token Vault Card */}
            <form
              onSubmit={handleSaveToken}
              className="rounded-lg border border-studio-border bg-studio-surface p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-studio-ink flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-studio-accent" />
                  <span>{locale === "ar" ? "توكن البوت في الخزينة" : "Telegram Bot Token (Vault)"}</span>
                </h2>
                <span
                  dir="ltr"
                  className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                    telegramStatus?.hasToken
                      ? "bg-studio-emerald-soft text-studio-emerald"
                      : "bg-studio-ground text-studio-muted"
                  }`}
                >
                  {existingBotKey ? existingBotKey.maskedValue : "not set"}
                </span>
              </div>

              <p className="text-[12px] text-studio-muted">
                {locale === "ar"
                  ? "يُحفظ TELEGRAM_BOT_TOKEN مشفراً داخل Vault. في وضع الاختبار المحلي يمكنك استخدام المحاكي أدناه بدون توكن فعلي."
                  : "Stored encrypted inside CredentialVault as TELEGRAM_BOT_TOKEN. Use the local simulator below without a real token."}
              </p>

              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  dir="ltr"
                  value={botTokenInput}
                  onChange={(e) => setBotTokenInput(e.target.value)}
                  placeholder="123456789:AAH..."
                  className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[12.5px]"
                />
                <button
                  type="submit"
                  disabled={savingToken || !botTokenInput.trim()}
                  className="px-3 py-1.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium disabled:opacity-50"
                >
                  {locale === "ar" ? "حفظ مشفر" : "Save Key"}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={testingBot || !telegramStatus?.hasToken}
                  onClick={() => void handleTestBot()}
                  className="px-3 py-1.5 rounded border border-studio-border bg-studio-ground text-[12px] font-medium hover:border-studio-accent disabled:opacity-50"
                >
                  {testingBot
                    ? locale === "ar"
                      ? "جارٍ الفحص…"
                      : "Testing…"
                    : locale === "ar"
                      ? "فحص اتصال getMe"
                      : "Test getMe"}
                </button>
                {existingBotKey && (
                  <button
                    type="button"
                    disabled={savingToken}
                    onClick={() => void handleRemoveToken()}
                    className="px-3 py-1.5 rounded border border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson text-[12px]"
                  >
                    {locale === "ar" ? "حذف التوكن" : "Delete Token"}
                  </button>
                )}
                {telegramStatus?.botUsername && (
                  <span dir="ltr" className="font-mono text-[11.5px] text-studio-emerald">
                    @{telegramStatus.botUsername}
                  </span>
                )}
                {telegramStatus?.lastError && (
                  <span dir="ltr" className="font-mono text-[11px] text-studio-crimson">
                    {telegramStatus.lastError}
                  </span>
                )}
              </div>
            </form>

            {/* Fail-Closed Allowlist & Bridge Policy */}
            <form
              onSubmit={handleSavePolicy}
              className="rounded-lg border border-studio-border bg-studio-surface p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-studio-ink">
                  {locale === "ar" ? "سياسة السماح والإشعارات" : "Access Allowlist & Bridge Policy"}
                </h2>
                <label className="inline-flex items-center gap-1.5 text-[12px] font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tgEnabled}
                    onChange={(e) => setTgEnabled(e.target.checked)}
                  />
                  <span>{locale === "ar" ? "تفعيل الجسر" : "Bridge Enabled"}</span>
                </label>
              </div>

              <label className="block space-y-1 text-[12px]">
                <span className="font-medium text-studio-ink">
                  {locale === "ar"
                    ? "معرفات المحادثات المسموحة (Fail-Closed Allowlist)"
                    : "Allowed Chat IDs (comma or space separated — fail-closed)"}
                </span>
                <input
                  dir="ltr"
                  value={tgAllowedChatsText}
                  onChange={(e) => setTgAllowedChatsText(e.target.value)}
                  placeholder="10001, -100998877"
                  className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[12.5px]"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 text-[12px]">
                  <span className="font-medium text-studio-ink">
                    {locale === "ar" ? "الموظف الافتراضي" : "Default Employee"}
                  </span>
                  <select
                    value={tgDefaultEmpId}
                    onChange={(e) => setTgDefaultEmpId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[12.5px]"
                  >
                    {employees.map((emp) => (
                      <option key={emp.profile.id} value={emp.profile.id}>
                        {locale === "ar" ? emp.profile.nameAr : emp.profile.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-[12px]">
                  <span className="font-medium text-studio-ink">
                    {locale === "ar" ? "فترة السحب (ms)" : "Poll Interval (ms)"}
                  </span>
                  <input
                    type="number"
                    min={1500}
                    max={60000}
                    dir="ltr"
                    value={tgPollMs}
                    onChange={(e) => setTgPollMs(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[12.5px]"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap gap-3 text-[12px]">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tgNotifyApprovals}
                      onChange={(e) => setTgNotifyApprovals(e.target.checked)}
                    />
                    <span>{locale === "ar" ? "تنبيهات الموافقات" : "Push Tier 3 Approvals"}</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tgNotifyRuns}
                      onChange={(e) => setTgNotifyRuns(e.target.checked)}
                    />
                    <span>{locale === "ar" ? "نتائج التشغيل" : "Push Run Completions"}</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingPolicy}
                  className="px-3.5 py-1.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium disabled:opacity-50"
                >
                  {savingPolicy
                    ? locale === "ar"
                      ? "جارٍ الحفظ…"
                      : "Saving…"
                    : locale === "ar"
                      ? "حفظ السياسة"
                      : "Save Policy"}
                </button>
              </div>
            </form>
          </div>

          {/* Local Simulator + Audit Transcript */}
          <div className="rounded-lg border border-studio-border bg-studio-surface p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-studio-ink flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-studio-accent" />
                <span>
                  {locale === "ar"
                    ? "محاكي رسائل Telegram المحلي وسجل المراسلات"
                    : "Local Telegram Simulator & Audit Log"}
                </span>
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {["/status", "/team", "/approvals", "@general-manager ملخص سريع؟"].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setSimText(sample)}
                    dir="auto"
                    className="px-2 py-0.5 rounded border border-studio-border bg-studio-ground text-[11px] text-studio-muted hover:text-studio-ink"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSimulate} className="flex flex-wrap gap-2">
              <input
                dir="ltr"
                value={simChatId}
                onChange={(e) => setSimChatId(e.target.value)}
                placeholder="Chat ID (e.g. 10001)"
                className="w-40 px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint font-mono text-[12.5px]"
              />
              <input
                dir="auto"
                value={simText}
                onChange={(e) => setSimText(e.target.value)}
                placeholder="/status, /team, /ask <question>, or @employee ..."
                className="flex-1 min-w-[220px] px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px]"
              />
              <button
                type="submit"
                disabled={simulating}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12.5px] font-medium disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{simulating ? "Sending…" : locale === "ar" ? "محاكاة رسالة" : "Simulate Send"}</span>
              </button>
            </form>

            <div className="space-y-2 max-h-80 overflow-y-auto pt-1">
              {telegramMessages.length === 0 ? (
                <div className="text-[12.5px] text-studio-muted py-3">
                  {locale === "ar"
                    ? "لا توجد رسائل Telegram مسجلة بعد."
                    : "No Telegram messages recorded yet."}
                </div>
              ) : (
                telegramMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded border p-2.5 text-[12.5px] space-y-1 ${
                      msg.direction === "inbound"
                        ? "border-studio-border bg-studio-ground/60"
                        : "border-studio-accent/25 bg-studio-blueprint"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-studio-muted font-mono" dir="ltr">
                      <span>
                        {msg.direction === "inbound" ? "INBOUND <-" : "OUTBOUND ->"} chat:{msg.chatId}
                      </span>
                      <span>{formatShortTime(msg.createdAt)}</span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[12.5px] text-studio-ink" dir="auto">
                      {msg.text}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
