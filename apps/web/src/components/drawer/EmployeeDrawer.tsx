import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Cpu,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { FeedbackRating, LearningTargetKind, RiskTier, RuntimeProvider } from "@virtual-office/shared";
import { useVoiceInput } from "../../hooks/useVoiceInput.ts";
import { t } from "../../i18n/translations.ts";
import type { StoredRunEvent } from "../../lib/api.ts";
import { selectEmployeeLiveState, useOfficeStore } from "../../store/office-store.ts";
import { MarkdownMessage } from "../common/MarkdownMessage.tsx";

function RunTraceCard({
  runId,
  events,
  defaultExpanded,
}: {
  runId: string;
  events: StoredRunEvent[];
  defaultExpanded: boolean;
}) {
  const { locale, runs, setActiveView, selectEmployee } = useOfficeStore();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const run = runs.find((r) => r.id === runId);

  if (events.length === 0 && !run) {
    return null;
  }

  const traceItems = events.filter((e) => e.eventType !== "text_delta");

  return (
    <div className="mt-2 border border-studio-border rounded-md bg-studio-blueprint overflow-hidden text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between gap-2 bg-studio-ground/70 hover:bg-studio-ground text-start"
      >
        <span className="flex items-center gap-2 font-medium text-studio-ink">
          <Terminal className="w-3.5 h-3.5 text-studio-accent" />
          <span>{t(locale, "liveTraceTitle")}</span>
          <span className="font-mono text-[11px] text-studio-muted">
            ({traceItems.length})
          </span>
          {run && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                run.status === "COMPLETED"
                  ? "bg-studio-emerald-soft text-studio-emerald"
                  : run.status === "WAITING_APPROVAL"
                    ? "bg-studio-amber-soft text-studio-amber"
                    : run.status === "FAILED" ||
                        run.status === "BUDGET_EXCEEDED" ||
                        run.status === "TIMED_OUT"
                      ? "bg-studio-crimson-soft text-studio-crimson"
                      : "bg-studio-accent-soft text-studio-accent"
              }`}
            >
              {run.status}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-studio-muted" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-studio-muted" />
        )}
      </button>

      {expanded && (
        <div className="p-2.5 pb-3.5 space-y-1.5 max-h-72 overflow-y-auto">
          {traceItems.map((item) => {
            const ev = item.event;
            if (ev.type === "context_assembled") {
              return (
                <div
                  key={item.seq}
                  className="px-2.5 py-1.5 rounded border border-studio-border bg-studio-surface flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-studio-muted">
                    {t(locale, "contextAssembled")}:{" "}
                    <strong className="font-mono text-studio-ink">
                      ~{ev.tokenEstimate} tok
                    </strong>{" "}
                    · {t(locale, "memoriesInjected")}:{" "}
                    <strong className="font-mono text-studio-ink">
                      {ev.injectedMemoryIds.length}
                    </strong>
                  </span>
                  {ev.hasUntrustedExternalInput && (
                    <span className="px-1.5 py-0.5 rounded bg-studio-crimson-soft text-studio-crimson text-[10px] font-semibold">
                      {t(locale, "untrustedBadge")}
                    </span>
                  )}
                </div>
              );
            }
            if (ev.type === "status") {
              return (
                <div key={item.seq} className="text-studio-muted px-1">
                  • <span className="font-mono text-[11px]">{ev.status}</span>
                  {ev.detail ? ` — ${ev.detail}` : ""}
                </div>
              );
            }
            if (ev.type === "thinking") {
              return (
                <div
                  key={item.seq}
                  className="px-2.5 py-1.5 rounded bg-studio-ground/60 text-studio-muted italic"
                >
                  {ev.text}
                </div>
              );
            }
            if (ev.type === "tool_call") {
              return (
                <div
                  key={item.seq}
                  className="px-2.5 py-1.5 rounded border border-studio-border bg-studio-surface font-mono text-[11px]"
                >
                  <div className="flex items-center gap-1.5 text-studio-accent font-semibold">
                    <Wrench className="w-3 h-3" />
                    <span>{ev.toolName}</span>
                    {ev.riskTier && (
                      <span className="text-[10px] text-studio-muted">({ev.riskTier})</span>
                    )}
                  </div>
                  <div className="mt-1 text-studio-muted break-all">
                    {JSON.stringify(ev.args)}
                  </div>
                </div>
              );
            }
            if (ev.type === "tool_result") {
              return (
                <div
                  key={item.seq}
                  className={`px-2.5 py-1.5 rounded border font-mono text-[11px] ${
                    ev.success
                      ? "border-studio-emerald/25 bg-studio-emerald-soft/40 text-studio-ink"
                      : "border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson"
                  }`}
                >
                  <div>
                    {ev.success ? "✓" : "✕"} {ev.toolName}
                    {ev.truncated ? " [truncated -> artifact saved]" : ""}
                  </div>
                  <div dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-[11px] opacity-90">
                    {ev.outputPreview}
                  </div>
                </div>
              );
            }
            if (ev.type === "approval_requested") {
              return (
                <div
                  key={item.seq}
                  className="px-3 py-2 rounded border border-studio-amber/40 bg-studio-amber-soft space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-studio-amber">
                    <ShieldAlert className="w-4 h-4" />
                    <span>{ev.title}</span>
                  </div>
                  <p className="text-studio-ink text-[12px]">{ev.summary}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("approvals");
                      void selectEmployee(null);
                    }}
                    className="h-7 px-2.5 mb-0.5 rounded bg-studio-amber text-white text-[11px] font-medium hover:opacity-95"
                  >
                    {t(locale, "jumpToApproval")} →
                  </button>
                </div>
              );
            }
            if (ev.type === "usage") {
              return (
                <div
                  key={item.seq}
                  className="px-2.5 py-1 rounded bg-studio-surface border border-studio-border font-mono text-[11px] text-studio-muted flex items-center justify-between"
                >
                  <span>
                    tokens: {ev.inputTokens} in / {ev.outputTokens} out
                  </span>
                  <span className="text-studio-ink font-semibold">
                    ${ev.costUsd.toFixed(4)} ({ev.mode ?? "live"})
                  </span>
                </div>
              );
            }
            if (ev.type === "error") {
              return (
                <div
                  key={item.seq}
                  className="px-2.5 py-1.5 rounded border border-studio-crimson/40 bg-studio-crimson-soft text-studio-crimson"
                >
                  <div className="font-mono font-semibold text-[11px] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{ev.errorCode}</span>
                  </div>
                  <div className="mt-0.5 text-[12px]">{ev.message}</div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

export function EmployeeDrawer({
  prefillPrompt,
  linkedTaskId,
  onClearPrefill,
}: {
  prefillPrompt?: string;
  linkedTaskId?: string | null;
  onClearPrefill?: () => void;
}) {
  const {
    locale,
    selectedEmployeeId,
    selectEmployee,
    employees,
    providers,
    runs,
    approvals,
    activeProjectId,
    runMode,
    conversationsByEmployee,
    selectedConversationIdByEmployee,
    selectConversation,
    messagesByConversationId,
    eventsByRunId,
    liveDeltaByRunId,
    startRun,
    cancelRun,
    summarizeConversation,
    submitLearningFeedback,
    setActiveView,
  } = useOfficeStore();

  const employee = useMemo(
    () => employees.find((e) => e.profile.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  const [tab, setTab] = useState<"chat" | "permissions">("chat");
  const [providerOverride, setProviderOverride] = useState<RuntimeProvider>("agy");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [riskTier, setRiskTier] = useState<RiskTier>("tier1_auto");
  const [prompt, setPrompt] = useState("");
  const [mockScenario, setMockScenario] = useState("default");
  const [showExternal, setShowExternal] = useState(false);
  const [externalSource, setExternalSource] = useState("email:external@example.com");
  const [externalContent, setExternalContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [feedbackRunId, setFeedbackRunId] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<FeedbackRating>("correction");
  const [feedbackTarget, setFeedbackTarget] = useState<LearningTargetKind>("memory_note");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [expandedWidth, setExpandedWidth] = useState(false);
  const [composerSettingsOpen, setComposerSettingsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput(
    (transcript) => setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript)),
    locale === "ar" ? "ar-EG" : "en-US",
  );

  useEffect(() => {
    if (!employee) return;
    setProviderOverride(employee.profile.runtime.provider);
    setModelOverride(employee.profile.runtime.model);
    setRiskTier("tier1_auto");
    setSendError(null);
  }, [employee?.profile.id]);

  useEffect(() => {
    if (prefillPrompt) {
      setPrompt(prefillPrompt);
      setTab("chat");
    }
  }, [prefillPrompt]);

  const activeConvId = employee
    ? (selectedConversationIdByEmployee[employee.profile.id] ?? null)
    : null;
  const messages = activeConvId ? (messagesByConversationId[activeConvId] ?? []) : [];

  const convRuns = useMemo(() => {
    if (!employee) return [];
    return runs.filter(
      (r) =>
        r.employeeId === employee.profile.id &&
        (activeConvId ? r.conversationId === activeConvId : true),
    );
  }, [runs, employee, activeConvId]);

  const activeStreamingRun = convRuns.find(
    (r) => r.status === "RUNNING" || r.status === "PLANNING" || r.status === "QUEUED",
  );
  const streamingText = activeStreamingRun ? (liveDeltaByRunId[activeStreamingRun.id] ?? "") : "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  useEffect(() => {
    if (!employee) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void selectEmployee(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [employee, selectEmployee]);

  if (!employee) {
    return null;
  }

  const live = selectEmployeeLiveState({ runs, approvals }, employee.profile.id);
  const conversations = conversationsByEmployee[employee.profile.id] ?? [];
  const activeConversation = conversations.find((c) => c.id === activeConvId) ?? null;
  const selectedProviderHealth = providers.find((p) => p.provider === providerOverride);
  const availableModels = selectedProviderHealth?.models.length
    ? selectedProviderHealth.models
    : [employee.profile.runtime.model];

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await startRun({
        employeeId: employee.profile.id,
        conversationId: activeConvId ?? undefined,
        projectId: activeProjectId ?? undefined,
        taskId: linkedTaskId ?? undefined,
        prompt: trimmed,
        mode: runMode,
        riskTier,
        providerOverride: runMode === "mock" ? "mock" : providerOverride,
        modelOverride: runMode === "mock" ? undefined : modelOverride,
        mockScenario: runMode === "mock" ? mockScenario : undefined,
        externalInputs:
          showExternal && externalContent.trim()
            ? [{ source: externalSource.trim() || "external", content: externalContent.trim() }]
            : undefined,
      });
      setPrompt("");
      onClearPrefill?.();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`fixed inset-y-0 end-0 z-40 w-full ${
        expandedWidth ? "max-w-[780px]" : "max-w-[540px]"
      } bg-studio-surface border-s border-studio-border flex flex-col shadow-float transition-[max-width] duration-150`}
      role="dialog"
      aria-label={employee.profile.nameAr}
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-studio-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-studio-subtle border border-studio-border-strong flex items-center justify-center font-mono text-[12px] font-semibold text-studio-accent shrink-0">
            {employee.profile.avatar}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-studio-ink truncate">
                {locale === "ar" ? employee.profile.nameAr : employee.profile.name}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  live.status === "working" || live.status === "queued"
                    ? "bg-studio-emerald-soft text-studio-emerald"
                    : live.status === "waiting_approval"
                      ? "bg-studio-amber-soft text-studio-amber"
                      : live.status === "failed"
                        ? "bg-studio-crimson-soft text-studio-crimson"
                        : "bg-studio-subtle text-studio-muted"
                }`}
              >
                {live.status === "working"
                  ? t(locale, "statusWorking")
                  : live.status === "waiting_approval"
                    ? t(locale, "statusWaitingApproval")
                    : live.status === "failed"
                      ? t(locale, "statusFailed")
                      : t(locale, "statusIdle")}
              </span>
            </div>
            <div className="text-[12px] text-studio-muted truncate">
              {locale === "ar" ? employee.profile.roleAr : employee.profile.role}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setExpandedWidth((v) => !v)}
            className="p-1.5 rounded-lg text-studio-muted hover:text-studio-ink hover:bg-studio-subtle hidden sm:inline-flex transition-colors"
            aria-label={expandedWidth ? "Shrink Drawer" : "Expand Drawer"}
            title={expandedWidth ? (locale === "ar" ? "تصغير الدرج" : "Compact Width") : locale === "ar" ? "توسيع الدرج" : "Expand Width"}
          >
            {expandedWidth ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => void selectEmployee(null)}
            className="p-1.5 rounded-lg text-studio-muted hover:text-studio-ink hover:bg-studio-subtle transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 border-b border-studio-border flex items-center justify-between gap-4 text-[13px]">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={`py-2.5 border-b-2 font-medium transition-colors ${
              tab === "chat"
                ? "border-studio-accent text-studio-ink"
                : "border-transparent text-studio-muted hover:text-studio-ink"
            }`}
          >
            {t(locale, "drawerChatTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("permissions")}
            className={`py-2.5 border-b-2 font-medium transition-colors ${
              tab === "permissions"
                ? "border-studio-accent text-studio-ink"
                : "border-transparent text-studio-muted hover:text-studio-ink"
            }`}
          >
            {t(locale, "drawerPermissionsTab")}
          </button>
        </div>
        <span dir="ltr" className="font-mono text-[11px] text-studio-faint truncate max-w-[180px]">
          {runMode === "mock" ? "mock" : `${providerOverride} · ${modelOverride}`}
        </span>
      </div>

      {tab === "chat" ? (
        <>
          {/* Thread Selector */}
          <div className="px-4 py-2 border-b border-studio-border flex items-center justify-between gap-2 bg-studio-surface">
            <select
              value={activeConvId ?? ""}
              onChange={(e) =>
                void selectConversation(employee.profile.id, e.target.value || null)
              }
              className="h-7 px-2 text-[12px] rounded border border-studio-border bg-studio-blueprint flex-1 min-w-0"
            >
              <option value="">{t(locale, "newConversation")}</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void selectConversation(employee.profile.id, null)}
              className="h-7 px-2.5 rounded border border-studio-border hover:bg-studio-ground text-[12px] flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{locale === "ar" ? "جديد" : "New"}</span>
            </button>
            {activeConvId && messages.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  setSummaryExpanded(true);
                  void summarizeConversation(activeConvId);
                }}
                className="h-7 px-2 rounded border border-studio-border hover:bg-studio-ground text-[11px] flex items-center gap-1 shrink-0 text-studio-muted"
                title={t(locale, "rollingSummaryLabel")}
              >
                <BookOpen className="w-3 h-3" />
                <span>{t(locale, "summarizeNowBtn")}</span>
              </button>
            )}
          </div>

          {activeConversation?.rollingSummary && (
            <div className="px-4 py-2 border-b border-studio-border bg-studio-ground/50 text-[12px]">
              <button
                type="button"
                onClick={() => setSummaryExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 text-studio-ink font-medium"
              >
                <span className="flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-studio-accent" />
                  <span>{t(locale, "rollingSummaryLabel")}</span>
                </span>
                {summaryExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-studio-muted" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-studio-muted" />
                )}
              </button>
              {summaryExpanded && (
                <pre className="mt-1.5 text-[11px] text-studio-muted whitespace-pre-wrap font-sans leading-relaxed max-h-36 overflow-y-auto">
                  {activeConversation.rollingSummary}
                </pre>
              )}
            </div>
          )}

          {/* Messages & Traces Stream */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !activeStreamingRun ? (
              <div className="py-12 text-center text-[13px] text-studio-muted">
                {t(locale, "noMessagesYet")}
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === "user";
                const runEvents = msg.runId ? (eventsByRunId[msg.runId] ?? []) : [];
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[92%] px-3.5 py-2.5 rounded-lg text-[13px] break-words leading-relaxed ${
                        isUser
                          ? "bg-studio-ink text-studio-surface whitespace-pre-wrap"
                          : "bg-studio-blueprint border border-studio-border text-studio-ink"
                      }`}
                    >
                      {isUser ? msg.content : <MarkdownMessage content={msg.content} />}
                    </div>
                    {!isUser && msg.runId && (
                      <div className="w-full space-y-1.5">
                        <RunTraceCard
                          runId={msg.runId}
                          events={runEvents}
                          defaultExpanded={convRuns[0]?.id === msg.runId}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFeedbackRunId(feedbackRunId === msg.runId ? null : msg.runId!);
                              setFeedbackBanner(null);
                            }}
                            className="text-[11px] text-studio-accent hover:underline flex items-center gap-1"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>{t(locale, "teachFeedbackBtn")}</span>
                          </button>
                        </div>

                        {feedbackRunId === msg.runId && (
                          <div className="p-2.5 rounded border border-studio-border bg-studio-ground/70 space-y-2 text-[12px]">
                            <div className="flex items-center gap-2">
                              <select
                                value={feedbackRating}
                                onChange={(e) => setFeedbackRating(e.target.value as FeedbackRating)}
                                className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[11px]"
                              >
                                <option value="correction">correction</option>
                                <option value="issue">issue</option>
                                <option value="positive">positive</option>
                              </select>
                              <select
                                value={feedbackTarget}
                                onChange={(e) =>
                                  setFeedbackTarget(e.target.value as LearningTargetKind)
                                }
                                className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[11px]"
                              >
                                <option value="memory_note">memory_note</option>
                                <option value="employee_skill">employee_skill</option>
                              </select>
                            </div>
                            <textarea
                              rows={2}
                              value={feedbackText}
                              onChange={(e) => setFeedbackText(e.target.value)}
                              placeholder={
                                locale === "ar"
                                  ? "اكتب التصحيح أو القاعدة المستفادة..."
                                  : "Describe the correction or rule to learn..."
                              }
                              className="w-full p-2 text-[12px] rounded border border-studio-border bg-studio-surface resize-none"
                            />
                            <div className="flex items-center justify-between gap-2">
                              {feedbackBanner ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveView("approvals");
                                    void selectEmployee(null);
                                  }}
                                  className="text-[11px] text-studio-emerald font-semibold underline"
                                >
                                  {feedbackBanner} →
                                </button>
                              ) : (
                                <span />
                              )}
                              <button
                                type="button"
                                disabled={!feedbackText.trim()}
                                onClick={async () => {
                                  const res = await submitLearningFeedback({
                                    employeeId: employee.profile.id,
                                    runId: msg.runId,
                                    conversationId: activeConvId,
                                    projectId: activeProjectId,
                                    rating: feedbackRating,
                                    targetKind: feedbackTarget,
                                    targetSkillName:
                                      feedbackTarget === "employee_skill" ? "core" : undefined,
                                    feedbackText: feedbackText.trim(),
                                    autoSubmitForApproval: true,
                                  });
                                  setFeedbackText("");
                                  setFeedbackBanner(
                                    locale === "ar"
                                      ? `تم إرسال ${res.proposal.id} للموافقات`
                                      : `Queued ${res.proposal.id} for Approval`,
                                  );
                                }}
                                className="h-7 px-3 rounded bg-studio-ink text-studio-surface text-[11px] font-semibold disabled:opacity-45"
                              >
                                {locale === "ar" ? "إرسال للتعلّم" : "Submit"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Active / Paused / Failed Run Live Block (when assistant final message isn't appended yet) */}
            {activeStreamingRun && (
              <div className="flex flex-col items-start">
                <div className="w-full px-3.5 py-2.5 rounded-lg bg-studio-blueprint border border-studio-accent/35 text-[13px] whitespace-pre-wrap break-words">
                  {streamingText || (
                    <span className="text-studio-muted animate-pulse">
                      {locale === "ar" ? "جاري التنفيذ..." : "Executing..."}
                    </span>
                  )}
                </div>
                <div className="w-full">
                  <RunTraceCard
                    runId={activeStreamingRun.id}
                    events={eventsByRunId[activeStreamingRun.id] ?? []}
                    defaultExpanded={true}
                  />
                </div>
              </div>
            )}

            {!activeStreamingRun &&
              convRuns[0] &&
              ["FAILED", "WAITING_APPROVAL", "CANCELLED", "TIMED_OUT", "BUDGET_EXCEEDED"].includes(
                convRuns[0].status,
              ) &&
              !messages.some((m) => m.runId === convRuns[0]?.id) && (
                <div className="w-full">
                  <RunTraceCard
                    runId={convRuns[0].id}
                    events={eventsByRunId[convRuns[0].id] ?? []}
                    defaultExpanded={true}
                  />
                </div>
              )}

            <div ref={bottomRef} />
          </div>

          {/* Composer Docked Runtime Settings + Input */}
          <div className="p-4 border-t border-studio-border bg-studio-surface space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setComposerSettingsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-studio-border bg-studio-blueprint text-studio-muted hover:text-studio-ink transition-colors"
              >
                <Cpu className="w-3.5 h-3.5 text-studio-accent" />
                <span dir="ltr" className="font-mono">
                  {runMode === "mock" ? `mock (${mockScenario})` : `${providerOverride} · ${riskTier === "tier2_guarded" ? "Tier 2" : "Tier 1"}`}
                </span>
                {composerSettingsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!voice.supported}
                  onClick={voice.toggle}
                  title={
                    voice.supported
                      ? locale === "ar"
                        ? "إملاء صوتي"
                        : "Voice dictation"
                      : locale === "ar"
                        ? "المتصفح لا يدعم الإملاء الصوتي"
                        : "SpeechRecognition unavailable in this browser"
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${
                    voice.listening
                      ? "border-studio-crimson bg-studio-crimson-soft text-studio-crimson font-medium"
                      : "border-studio-border bg-studio-blueprint text-studio-muted hover:text-studio-ink disabled:opacity-45"
                  }`}
                >
                  {voice.listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  <span>
                    {voice.listening
                      ? locale === "ar"
                        ? "جارٍ التسجيل…"
                        : "Listening…"
                      : locale === "ar"
                        ? "صوت"
                        : "Voice"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowExternal((v) => !v)}
                  className="px-2 py-1 rounded-md border border-studio-border bg-studio-blueprint text-studio-muted hover:text-studio-ink transition-colors"
                >
                  {t(locale, "externalInputToggle")}
                </button>
              </div>
            </div>

            {composerSettingsOpen && (
              <div className="p-2.5 rounded-lg border border-studio-border bg-studio-blueprint flex flex-wrap items-center gap-2 text-[11.5px]">
                <select
                  aria-label={t(locale, "providerLabel")}
                  value={runMode === "mock" ? "mock" : providerOverride}
                  disabled={runMode === "mock"}
                  onChange={(e) => {
                    const nextProv = e.target.value as RuntimeProvider;
                    setProviderOverride(nextProv);
                    const nextHealth = providers.find((p) => p.provider === nextProv);
                    if (nextHealth?.models[0]) {
                      setModelOverride(nextHealth.models[0]);
                    }
                  }}
                  className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[11px]"
                >
                  {(
                    [
                      "agy",
                      "codex",
                      "claude",
                      "gemini_api",
                      "openai_api",
                      "anthropic_api",
                      "openrouter_api",
                      "ollama",
                      "mock",
                    ] as RuntimeProvider[]
                  ).map((prov) => {
                    const health = providers.find((p) => p.provider === prov);
                    const tag = health?.available ? "ready" : "setup";
                    return (
                      <option key={prov} value={prov}>
                        {prov} ({tag})
                      </option>
                    );
                  })}
                </select>

                {runMode !== "mock" && (
                  <select
                    aria-label={t(locale, "modelLabel")}
                    value={modelOverride}
                    onChange={(e) => setModelOverride(e.target.value)}
                    className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[11px] max-w-[180px]"
                  >
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label={t(locale, "riskTierLabel")}
                  value={riskTier}
                  onChange={(e) => setRiskTier(e.target.value as RiskTier)}
                  className="h-7 px-2 rounded border border-studio-border bg-studio-surface text-[11px]"
                >
                  <option value="tier1_auto">{t(locale, "tier1Label")}</option>
                  <option value="tier2_guarded">{t(locale, "tier2Label")}</option>
                </select>

                {runMode === "mock" && (
                  <select
                    value={mockScenario}
                    onChange={(e) => setMockScenario(e.target.value)}
                    className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[11px]"
                  >
                    <option value="default">default</option>
                    <option value="approval">approval (Tier 3)</option>
                    <option value="tainted_approval">tainted_approval</option>
                    <option value="loop">loop (circuit breaker)</option>
                    <option value="budget_overrun">budget_overrun</option>
                    <option value="slow">slow (cancel / timeout)</option>
                  </select>
                )}

                <button
                  type="button"
                  dir="ltr"
                  disabled={voice.listening}
                  onClick={() =>
                    voice.setVoiceLang(voice.voiceLang === "ar-EG" ? "en-US" : "ar-EG")
                  }
                  className="h-7 px-2 rounded border border-studio-border bg-studio-surface font-mono text-[10.5px] text-studio-muted hover:text-studio-ink"
                >
                  Voice: {voice.voiceLang}
                </button>
              </div>
            )}

            {/* Quick Role Prompt Chips (visible prominently on fresh threads) */}
            <div className="flex flex-wrap gap-1.5">
              {(employee.profile.department === "engineering"
                ? locale === "ar"
                  ? [
                      "راجع الملفات الأساسية واقترح خطة تنفيذ مختصرة",
                      "افحص الأخطاء المحتملة وحالات الحافة",
                    ]
                  : [
                      "Audit active files and outline concise implementation steps",
                      "Inspect edge cases and verification checks",
                    ]
                : employee.profile.department === "executive"
                  ? locale === "ar"
                    ? [
                        "لخّص حالة المكتب والأولويات العاجلة",
                        "قسّم الهدف الحالي إلى مهام واضحة للفريق",
                      ]
                    : [
                        "Summarize office status & immediate priorities",
                        "Break down the current objective across specialists",
                      ]
                  : locale === "ar"
                    ? [
                        "قدّم خطة تنفيذ مختصرة قابلة للقياس",
                        "راجع المخرجات الحالية واقترح تحسينات",
                      ]
                    : [
                        "Draft a concise, measurable execution plan",
                        "Review current deliverables & suggest improvements",
                      ]
              ).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setPrompt(chip)}
                  className="px-2.5 py-1 rounded-full border border-studio-border bg-studio-blueprint text-[11px] text-studio-muted hover:text-studio-ink hover:border-studio-accent transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>

            {showExternal && (
              <div className="p-2.5 rounded-lg border border-studio-border bg-studio-blueprint space-y-1.5">
                <input
                  value={externalSource}
                  onChange={(e) => setExternalSource(e.target.value)}
                  placeholder={t(locale, "externalSourcePlaceholder")}
                  className="w-full h-7 px-2 text-[11px] font-mono rounded border border-studio-border bg-studio-surface"
                />
                <textarea
                  rows={2}
                  value={externalContent}
                  onChange={(e) => setExternalContent(e.target.value)}
                  placeholder={t(locale, "externalContentPlaceholder")}
                  className="w-full p-2 text-[11px] rounded border border-studio-border bg-studio-surface resize-none"
                />
              </div>
            )}

            {sendError && (
              <div className="px-2.5 py-1.5 rounded bg-studio-crimson-soft text-studio-crimson text-[12px]">
                {sendError}
              </div>
            )}
            {voice.error && <div className="text-[11px] text-studio-crimson truncate">{voice.error}</div>}

            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={t(locale, "promptPlaceholder")}
                className="flex-1 p-2.5 text-[13px] rounded-md border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent resize-none"
              />
              {activeStreamingRun ? (
                <button
                  type="button"
                  onClick={() => void cancelRun(activeStreamingRun.id)}
                  className="h-10 px-3.5 rounded-md bg-studio-crimson text-white text-[12px] font-semibold flex items-center gap-1.5 shrink-0 hover:opacity-95"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{t(locale, "stopBtn")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!prompt.trim() || sending}
                  onClick={() => void handleSend()}
                  className="h-10 px-3.5 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1.5 shrink-0 hover:opacity-90 disabled:opacity-45"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t(locale, "sendBtn")}</span>
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Permissions & Skills Tab */
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[13px]">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-lg border border-studio-border bg-studio-blueprint">
              <div className="text-[11px] text-studio-muted">{t(locale, "maxRiskTier")}</div>
              <div className="mt-1 font-mono font-semibold text-studio-ink">
                {employee.permissions.maxRiskTier}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-studio-border bg-studio-blueprint">
              <div className="text-[11px] text-studio-muted">{t(locale, "maxSteps")}</div>
              <div className="mt-1 font-mono font-semibold text-studio-ink">
                {employee.permissions.maxStepsPerRun}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-studio-border bg-studio-blueprint">
              <div className="text-[11px] text-studio-muted">{t(locale, "taskBudget")}</div>
              <div className="mt-1 font-mono font-semibold text-studio-ink">
                ${employee.permissions.taskBudgetUsd.toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-studio-border bg-studio-blueprint">
              <div className="text-[11px] text-studio-muted">{t(locale, "dailyBudget")}</div>
              <div className="mt-1 font-mono font-semibold text-studio-ink">
                ${employee.permissions.dailyBudgetUsd.toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold text-studio-muted mb-2">
              {t(locale, "allowedTools")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {employee.permissions.allowedTools.map((tool) => (
                <span
                  key={tool}
                  className="px-2 py-1 rounded bg-studio-emerald-soft text-studio-emerald font-mono text-[11px]"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold text-studio-muted mb-2">
              {t(locale, "deniedTools")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {employee.permissions.deniedTools.length === 0 ? (
                <span className="text-studio-faint">—</span>
              ) : (
                employee.permissions.deniedTools.map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-1 rounded bg-studio-crimson-soft text-studio-crimson font-mono text-[11px]"
                  >
                    {tool}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[12px] font-semibold text-studio-muted mb-2">
              {t(locale, "skillsHeading")}
            </h3>
            <div className="space-y-2">
              {employee.skills.map((skill) => (
                <div
                  key={skill.name}
                  className="p-3 rounded-lg border border-studio-border bg-studio-blueprint"
                >
                  <div className="font-mono text-[12px] font-semibold text-studio-ink">
                    {skill.name}
                  </div>
                  <pre className="mt-1.5 text-[12px] text-studio-muted whitespace-pre-wrap font-sans leading-relaxed">
                    {skill.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
