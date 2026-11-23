import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Cpu,
  GitCompare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  FeedbackRating,
  LearningProposalStatus,
  LearningTargetKind,
  MemoryPolicy,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  MemoryVerification,
} from "@virtual-office/shared";
import { t } from "../../i18n/translations.ts";
import { useOfficeStore } from "../../store/office-store.ts";

type MemoryTab = "explorer" | "conflicts" | "learning" | "settings";

function formatMemoryLines(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
}

function UnifiedDiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre
      dir="ltr"
      className="p-2.5 rounded border border-studio-border bg-studio-blueprint text-[11px] font-mono text-left overflow-x-auto max-h-56 leading-relaxed"
    >
      {lines.map((line, idx) => {
        const cls = line.startsWith("+") && !line.startsWith("+++")
          ? "text-studio-emerald bg-studio-emerald-soft/45 block px-1"
          : line.startsWith("-") && !line.startsWith("---")
            ? "text-studio-crimson bg-studio-crimson-soft/45 block px-1"
            : line.startsWith("@@")
              ? "text-studio-accent font-semibold block px-1"
              : "text-studio-ink block px-1";
        return (
          <span key={idx} className={cls}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

export function MemoryView() {
  const {
    locale,
    employees,
    projects,
    activeProjectId,
    memoryResults,
    memorySearchMeta,
    memoryConflicts,
    learningProposals,
    vectorStatus,
    companyPolicies,
    searchMemory,
    createMemoryNote,
    promoteMemoryNote,
    loadMemoryGovernance,
    resolveMemoryConflict,
    recalculateMemoryDecay,
    syncVectors,
    submitLearningFeedback,
    rollbackLearningProposal,
    updatePolicies,
    setActiveView,
  } = useOfficeStore();

  const [tab, setTab] = useState<MemoryTab>("explorer");

  // Explorer state
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | MemoryScope>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | MemoryStatus>("active");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteScope, setNoteScope] = useState<MemoryScope>("company");
  const [noteProjectId, setNoteProjectId] = useState(activeProjectId ?? "");
  const [noteEmployeeId, setNoteEmployeeId] = useState("general-manager");
  const [noteType, setNoteType] = useState<MemoryType>("semantic");
  const [noteVerifiedBy, setNoteVerifiedBy] = useState<MemoryVerification>("human");
  const [noteTainted, setNoteTainted] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteMsg, setNoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Conflicts state
  const [conflictNotes, setConflictNotes] = useState<Record<string, string>>({});

  // Learning state
  const [learnEmpId, setLearnEmpId] = useState("senior-engineer");
  const [learnRating, setLearnRating] = useState<FeedbackRating>("correction");
  const [learnTargetKind, setLearnTargetKind] = useState<LearningTargetKind>("employee_skill");
  const [learnSkillName, setLearnSkillName] = useState("core");
  const [learnScope, setLearnScope] = useState<MemoryScope>("employee");
  const [learnFeedback, setLearnFeedback] = useState("");
  const [learnExpected, setLearnExpected] = useState("");
  const [learnFilter, setLearnFilter] = useState<"ALL" | LearningProposalStatus>("ALL");
  const [learnBanner, setLearnBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [rollbackForceIds, setRollbackForceIds] = useState<Record<string, boolean>>({});

  // Vector & Decay settings state
  const [policyDraft, setPolicyDraft] = useState<MemoryPolicy>({
    vectorEnabled: false,
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ftsWeight: 0.6,
    vectorWeight: 0.4,
    decayHalfLifeDays: 60,
    rollingSummaryEveryMessages: 8,
  });
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadMemoryGovernance();
  }, [loadMemoryGovernance]);

  useEffect(() => {
    if (companyPolicies?.memory) {
      setPolicyDraft(companyPolicies.memory);
    }
  }, [companyPolicies?.memory]);

  const runSearch = (
    nextQuery: string,
    nextScope: "all" | MemoryScope,
    nextStatus: "all" | MemoryStatus,
  ) => {
    void searchMemory(nextQuery, {
      scope: nextScope === "all" ? undefined : nextScope,
      status: nextStatus === "all" ? undefined : nextStatus,
      includeArchived: nextStatus === "all",
    });
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    setBusyAction("create_note");
    setNoteMsg(null);
    try {
      const effectiveType: MemoryType =
        noteVerifiedBy === "unverified" || noteTainted ? "working" : noteType;
      const res = await createMemoryNote({
        scope: noteScope,
        projectId: noteScope === "project" ? noteProjectId || projects[0]?.id || null : null,
        employeeId: noteScope === "employee" ? noteEmployeeId : null,
        memoryType: effectiveType,
        title: noteTitle.trim(),
        content: noteContent.trim(),
        verifiedBy: noteVerifiedBy,
        taintedByExternalInput: noteTainted,
        confidence: noteVerifiedBy === "human" ? 0.9 : 0.45,
        sourceCitations:
          noteVerifiedBy === "human"
            ? [{ kind: "human", ref: "founder-ui", summary: "Added by founder in Memory Explorer" }]
            : [{ kind: "conversation", ref: "working-draft", summary: "Unverified draft note" }],
      });
      setNoteTitle("");
      setNoteContent("");
      setShowNoteForm(false);
      setNoteMsg(
        res.conflictDetected
          ? {
              ok: false,
              text:
                locale === "ar"
                  ? `تم اكتشاف تعارض مع حقيقة موثّقة! تم تحويل الملاحظة لقسم التعارضات (${res.entry.conflictReason}).`
                  : `Conflict detected with verified truth! Routed to Conflicts tab (${res.entry.conflictReason}).`,
            }
          : {
              ok: true,
              text:
                locale === "ar"
                  ? `تم حفظ وفهرسة الملاحظة بنجاح (${res.entry.id}).`
                  : `Saved & indexed note (${res.entry.id}).`,
            },
      );
      runSearch(query, scopeFilter, statusFilter);
    } catch (err) {
      setNoteMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to save note" });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePromote = async (id: string) => {
    setBusyAction(`promote:${id}`);
    setNoteMsg(null);
    try {
      const res = await promoteMemoryNote(id, {
        targetType: "semantic",
        note: "Verified & promoted by founder via UI",
      });
      setNoteMsg(
        res.conflictDetected
          ? {
              ok: false,
              text:
                locale === "ar"
                  ? "أثناء الترقية تم اكتشاف تعارض مع حقيقة موثّقة — راجع تبويب التعارضات."
                  : "Conflict detected during promotion — review in Conflicts tab.",
            }
          : {
              ok: true,
              text:
                locale === "ar"
                  ? `تمت الترقية لحقيقة موثّقة (${res.entry.id}).`
                  : `Promoted to verified semantic memory (${res.entry.id}).`,
            },
      );
      runSearch(query, scopeFilter, statusFilter);
    } catch (err) {
      setNoteMsg({ ok: false, text: err instanceof Error ? err.message : "Promotion failed" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmitLearning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!learnFeedback.trim()) return;
    setBusyAction("submit_learning");
    setLearnBanner(null);
    try {
      const res = await submitLearningFeedback({
        employeeId: learnEmpId,
        projectId: learnScope === "project" ? activeProjectId || projects[0]?.id || null : null,
        rating: learnRating,
        targetKind: learnTargetKind,
        targetSkillName: learnTargetKind === "employee_skill" ? learnSkillName.trim() || "core" : undefined,
        scope: learnTargetKind === "memory_note" ? learnScope : "employee",
        feedbackText: learnFeedback.trim(),
        expectedBehavior: learnExpected.trim() || undefined,
        autoSubmitForApproval: true,
      });
      setLearnFeedback("");
      setLearnExpected("");
      setLearnBanner({
        ok: true,
        text:
          locale === "ar"
            ? `تم توليد المقترح ${res.proposal.id} (التقييم ${res.proposal.evaluation.score}/100) وإرساله لطابور الموافقات.`
            : `Proposal ${res.proposal.id} generated (${res.proposal.evaluation.score}/100) and queued for Tier 3 approval.`,
      });
    } catch (err) {
      setLearnBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to submit feedback",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRollback = async (id: string) => {
    setBusyAction(`rollback:${id}`);
    setLearnBanner(null);
    try {
      const prop = await rollbackLearningProposal(id, {
        reason: "Founder requested rollback from Controlled Learning view",
        force: Boolean(rollbackForceIds[id]),
      });
      setRollbackForceIds((prev) => ({ ...prev, [id]: false }));
      setLearnBanner({
        ok: true,
        text:
          locale === "ar"
            ? `تم التراجع عن التعديل ${prop.id} واستعادة الملف الأصلي بنجاح.`
            : `Rolled back proposal ${prop.id} cleanly.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rollback failed";
      if (msg.toLowerCase().includes("external") || msg.toLowerCase().includes("drift")) {
        setRollbackForceIds((prev) => ({ ...prev, [id]: true }));
      }
      setLearnBanner({ ok: false, text: msg });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction("save_settings");
    setSettingsMsg(null);
    try {
      await updatePolicies({ memory: policyDraft });
      await loadMemoryGovernance();
      setSettingsMsg({
        ok: true,
        text:
          locale === "ar"
            ? "تم حفظ إعدادات الذاكرة والبحث الدلالي في company.json."
            : "Saved memory & vector retrieval settings to company.json.",
      });
    } catch (err) {
      setSettingsMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to update settings",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncVectors = async () => {
    setBusyAction("sync_vectors");
    setSettingsMsg(null);
    try {
      const res = await syncVectors();
      setSettingsMsg({
        ok: !res.error,
        text: res.error
          ? `Sync partial/offline: ${res.error}`
          : locale === "ar"
            ? `تمت مزامنة المتجهات: ${res.embedded} جديد، ${res.skipped} محدث مسبقاً.`
            : `Vector sync complete: ${res.embedded} embedded, ${res.skipped} cached.`,
      });
    } catch (err) {
      setSettingsMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Vector sync failed",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecalcDecay = async () => {
    setBusyAction("recalc_decay");
    setSettingsMsg(null);
    try {
      const res = await recalculateMemoryDecay();
      setSettingsMsg({
        ok: true,
        text:
          locale === "ar"
            ? `تمت إعادة حساب معامل التقادم لـ ${res.updated} عنصر ذاكرة.`
            : `Recalculated decay scores across ${res.updated} active memories.`,
      });
    } catch (err) {
      setSettingsMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to recalculate decay",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const empMap = new Map(employees.map((e) => [e.profile.id, e]));
  const filteredProposals =
    learnFilter === "ALL"
      ? learningProposals
      : learningProposals.filter((p) => p.status === learnFilter);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {t(locale, "memoryTitle")}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">{t(locale, "memoryQuestion")}</p>
        </div>

        <div className="inline-flex flex-wrap p-0.5 rounded-md border border-studio-border bg-studio-surface gap-0.5">
          {(
            [
              { id: "explorer", label: t(locale, "memTabExplorer") },
              {
                id: "conflicts",
                label: t(locale, "memTabConflicts"),
                badge: memoryConflicts.length,
              },
              {
                id: "learning",
                label: t(locale, "memTabLearning"),
                badge: learningProposals.filter((p) => p.status === "PENDING_APPROVAL").length,
              },
              { id: "settings", label: t(locale, "memTabSettings") },
            ] as Array<{ id: MemoryTab; label: string; badge?: number }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
                tab === item.id
                  ? "bg-studio-subtle text-studio-ink"
                  : "text-studio-muted hover:text-studio-ink"
              }`}
            >
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  dir="ltr"
                  className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
                    tab === item.id
                      ? "bg-studio-border text-studio-ink"
                      : item.id === "conflicts"
                        ? "bg-studio-crimson-soft text-studio-crimson"
                        : "bg-studio-amber-soft text-studio-amber"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: MEMORY EXPLORER */}
      {tab === "explorer" && (
        <div className="space-y-3">
          <div className="bg-studio-surface border border-studio-border rounded-lg p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[230px]">
                <Search className="w-4 h-4 text-studio-faint absolute top-2.5 start-3" />
                <input
                  value={query}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuery(val);
                    runSearch(val, scopeFilter, statusFilter);
                  }}
                  placeholder={t(locale, "memorySearchPlaceholder")}
                  className="w-full h-9 ps-9 pe-3 text-[13px] rounded-md border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent"
                />
              </div>

              <div className="inline-flex p-0.5 rounded-md border border-studio-border bg-studio-ground">
                {(["all", "company", "project", "employee"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScopeFilter(s);
                      runSearch(query, s, statusFilter);
                    }}
                    className={`px-2.5 py-1 text-[12px] font-mono rounded ${
                      scopeFilter === s ? "bg-studio-ink text-studio-surface font-semibold" : "text-studio-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <select
                value={statusFilter}
                onChange={(e) => {
                  const next = e.target.value as "all" | MemoryStatus;
                  setStatusFilter(next);
                  runSearch(query, scopeFilter, next);
                }}
                className="h-9 px-2.5 text-[12px] font-mono rounded-md border border-studio-border bg-studio-blueprint"
              >
                <option value="active">status: active</option>
                <option value="conflict">status: conflict</option>
                <option value="superseded">status: superseded</option>
                <option value="all">status: all</option>
              </select>

              <button
                type="button"
                onClick={() => setShowNoteForm((v) => !v)}
                className="h-9 px-3 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "إضافة ملاحظة" : "Add Note"}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-studio-muted">
              <span dir="ltr">
                Engine:{" "}
                {memorySearchMeta?.vectorUsed
                  ? "Hybrid (FTS5 + Ollama Cosine)"
                  : `FTS5 Arabic/English (${memorySearchMeta?.vectorFallbackReason || "vectors off"})`}
              </span>
              <span dir="ltr">Results: {memoryResults.length}</span>
            </div>
          </div>

          {noteMsg && (
            <div
              className={`px-3 py-2 rounded-md border text-[12px] flex items-center justify-between gap-2 ${
                noteMsg.ok
                  ? "border-studio-emerald/35 bg-studio-emerald-soft text-studio-emerald"
                  : "border-studio-crimson/35 bg-studio-crimson-soft text-studio-crimson"
              }`}
            >
              <span>{noteMsg.text}</span>
              {!noteMsg.ok && memoryConflicts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("conflicts")}
                  className="px-2 py-0.5 rounded bg-studio-crimson text-white text-[11px] font-semibold shrink-0"
                >
                  {t(locale, "memTabConflicts")} →
                </button>
              )}
            </div>
          )}

          {showNoteForm && (
            <form
              onSubmit={(e) => void handleCreateNote(e)}
              className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
            >
              <div className="text-[13px] font-semibold text-studio-ink">
                {locale === "ar"
                  ? "إضافة حقيقة أو مسودة ذاكرة (تخضع لقواعد الأدلة وكشف التعارض)"
                  : "Create Evidence-Tagged Memory Note (Subject to Conflict & Evidence Checks)"}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-[12px]">
                <input
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder={locale === "ar" ? "عنوان الملاحظة..." : "Title..."}
                  className="md:col-span-2 h-9 px-3 rounded border border-studio-border bg-studio-blueprint"
                />
                <select
                  value={noteScope}
                  onChange={(e) => setNoteScope(e.target.value as MemoryScope)}
                  className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                >
                  <option value="company">scope: company</option>
                  <option value="project">scope: project</option>
                  <option value="employee">scope: employee</option>
                </select>
                <select
                  value={noteVerifiedBy}
                  onChange={(e) => setNoteVerifiedBy(e.target.value as MemoryVerification)}
                  className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                >
                  <option value="human">verifiedBy: human</option>
                  <option value="unverified">verifiedBy: unverified</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[12px]">
                {noteScope === "project" && (
                  <select
                    value={noteProjectId}
                    onChange={(e) => setNoteProjectId(e.target.value)}
                    className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
                  >
                    <option value="">Select project...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {noteScope === "employee" && (
                  <select
                    value={noteEmployeeId}
                    onChange={(e) => setNoteEmployeeId(e.target.value)}
                    className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
                  >
                    {employees.map((emp) => (
                      <option key={emp.profile.id} value={emp.profile.id}>
                        {locale === "ar" ? emp.profile.nameAr : emp.profile.name}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={noteVerifiedBy === "unverified" || noteTainted ? "working" : noteType}
                  disabled={noteVerifiedBy === "unverified" || noteTainted}
                  onChange={(e) => setNoteType(e.target.value as MemoryType)}
                  className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                >
                  <option value="semantic">type: semantic</option>
                  <option value="procedural">type: procedural</option>
                  <option value="working">type: working</option>
                </select>
                <label className="flex items-center gap-2 text-studio-muted">
                  <input
                    type="checkbox"
                    checked={noteTainted}
                    onChange={(e) => setNoteTainted(e.target.checked)}
                  />
                  <span>
                    {locale === "ar"
                      ? "من مصدر خارجي غير موثوق (Tainted)"
                      : "Tainted External Source"}
                  </span>
                </label>
              </div>

              {(noteVerifiedBy === "unverified" || noteTainted) && (
                <div className="text-[11px] text-studio-amber">
                  {locale === "ar"
                    ? "سيتم حفظ الملاحظة كـ working/unverified ولن تترقى تلقائياً لحقيقة موثّقة إلا بمراجعتك."
                    : "Invariant: Unverified or tainted notes are pinned to working memory until human promotion."}
                </div>
              )}

              <textarea
                required
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder={locale === "ar" ? "محتوى القاعدة أو الملاحظة..." : "Memory content..."}
                className="w-full p-3 text-[13px] rounded border border-studio-border bg-studio-blueprint resize-none"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNoteForm(false)}
                  className="h-8 px-3 rounded border border-studio-border text-[12px]"
                >
                  {locale === "ar" ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={busyAction === "create_note"}
                  className="h-8 px-4 rounded bg-studio-ink text-studio-surface text-[12px] font-semibold disabled:opacity-50"
                >
                  {locale === "ar" ? "حفظ وفهرسة" : "Save & Index"}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {memoryResults.map((entry) => {
              const eff = entry.effectiveScore ?? entry.confidence * entry.decayScore;
              const canPromote =
                entry.status === "active" &&
                (entry.verifiedBy === "unverified" ||
                  entry.memoryType === "working" ||
                  entry.memoryType === "episodic");
              return (
                <article
                  key={entry.id}
                  className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[14px] font-semibold text-studio-ink">{entry.title}</h2>
                      <span
                        dir="ltr"
                        className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px]"
                      >
                        {entry.scope}
                        {entry.employeeId ? `:${entry.employeeId}` : ""}
                        {entry.projectId ? `:${entry.projectId}` : ""}
                      </span>
                      <span
                        dir="ltr"
                        className="px-2 py-0.5 rounded bg-studio-accent-soft text-studio-accent font-mono text-[11px]"
                      >
                        {entry.memoryType}
                      </span>
                      <span
                        dir="ltr"
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                          entry.status === "active"
                            ? "bg-studio-emerald-soft text-studio-emerald"
                            : entry.status === "conflict"
                              ? "bg-studio-crimson-soft text-studio-crimson"
                              : "bg-studio-ground text-studio-muted"
                        }`}
                      >
                        {entry.status}
                      </span>
                      {entry.retrievalMode && (
                        <span
                          dir="ltr"
                          className="px-1.5 py-0.5 rounded bg-studio-ground text-studio-muted font-mono text-[10px]"
                        >
                          {entry.retrievalMode}
                        </span>
                      )}
                    </div>

                    <div dir="ltr" className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          entry.verifiedBy === "unverified"
                            ? "bg-studio-amber-soft text-studio-amber"
                            : "bg-studio-emerald-soft text-studio-emerald"
                        }`}
                      >
                        verified:{entry.verifiedBy}
                      </span>
                      <span className="text-studio-muted">
                        conf:{entry.confidence.toFixed(2)}
                      </span>
                      <span className="text-studio-muted">
                        decay:{entry.decayScore.toFixed(2)}
                      </span>
                      <span className="text-studio-ink font-semibold">
                        eff:{eff.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {entry.conflictReason && (
                    <div className="px-2.5 py-1.5 rounded bg-studio-crimson-soft text-studio-crimson text-[12px] flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{entry.conflictReason}</span>
                    </div>
                  )}

                  <p dir="auto" className="text-[13px] text-studio-ink whitespace-pre-wrap leading-relaxed">
                    {formatMemoryLines(entry.content)}
                  </p>

                  <div className="pt-2 border-t border-studio-border flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-studio-muted">
                    <div>
                      Citations:{" "}
                      {entry.sourceCitations.length > 0
                        ? entry.sourceCitations.map((c) => `${c.kind}:${c.ref}`).join(" | ")
                        : "none"}
                    </div>

                    <div className="flex items-center gap-3">
                      {canPromote && (
                        <button
                          type="button"
                          disabled={busyAction === `promote:${entry.id}`}
                          onClick={() => void handlePromote(entry.id)}
                          className="px-2.5 py-1 rounded-md bg-studio-emerald text-studio-ground font-sans text-[11px] font-semibold flex items-center gap-1 hover:opacity-90 disabled:opacity-50"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          <span>
                            {locale === "ar" ? "ترقية لحقيقة موثّقة" : "Promote to Semantic"}
                          </span>
                        </button>
                      )}
                      <span dir="ltr" className="truncate max-w-sm">
                        {entry.filePath}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: CONFLICTS */}
      {tab === "conflicts" && (
        <div className="space-y-3">
          {memoryConflicts.length === 0 ? (
            <div className="p-10 text-center bg-studio-surface border border-studio-border rounded-lg text-[13px] text-studio-muted">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-studio-emerald" />
              <p>
                {locale === "ar"
                  ? "لا توجد تعارضات مفتوحة في الذاكرة المؤسسية."
                  : "No open contradictions in verified memory."}
              </p>
            </div>
          ) : (
            memoryConflicts.map(({ entry, existing }) => (
              <article
                key={entry.id}
                className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-studio-crimson font-semibold text-[13px]">
                    <GitCompare className="w-4 h-4" />
                    <span>{entry.title}</span>
                  </div>
                  <span dir="ltr" className="font-mono text-[11px] text-studio-muted">
                    {entry.id}
                  </span>
                </div>

                {entry.conflictReason && (
                  <div className="px-3 py-2 rounded border border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson text-[12px]">
                    {entry.conflictReason}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-md border border-studio-emerald/35 bg-studio-blueprint space-y-1.5">
                    <div className="text-[11px] font-mono font-semibold text-studio-emerald">
                      {locale === "ar" ? "الحقيقة الموثّقة الحالية" : "Existing Verified Truth"}
                    </div>
                    {existing ? (
                      <>
                        <div className="text-[13px] font-semibold text-studio-ink">
                          {existing.title}
                        </div>
                        <p dir="auto" className="text-[12px] text-studio-ink whitespace-pre-wrap">
                          {formatMemoryLines(existing.content)}
                        </p>
                        <div dir="ltr" className="text-[10px] font-mono text-studio-muted">
                          conf:{existing.confidence.toFixed(2)} · verified:{existing.verifiedBy}
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px] text-studio-muted">
                        Original entry reference unavailable ({entry.conflictWithId})
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-md border border-studio-amber/45 bg-studio-blueprint space-y-1.5">
                    <div className="text-[11px] font-mono font-semibold text-studio-amber">
                      {locale === "ar" ? "المرشح المتعارض الجديد" : "Conflicting Candidate"}
                    </div>
                    <div className="text-[13px] font-semibold text-studio-ink">{entry.title}</div>
                    <p dir="auto" className="text-[12px] text-studio-ink whitespace-pre-wrap">
                      {formatMemoryLines(entry.content)}
                    </p>
                    <div dir="ltr" className="text-[10px] font-mono text-studio-muted">
                      conf:{entry.confidence.toFixed(2)} · verified:{entry.verifiedBy}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-studio-border flex flex-wrap items-center gap-2">
                  <input
                    value={conflictNotes[entry.id] ?? ""}
                    onChange={(e) =>
                      setConflictNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))
                    }
                    placeholder={locale === "ar" ? "سبب القرار (اختياري)..." : "Resolution note..."}
                    className="flex-1 min-w-[180px] h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
                  />
                  <button
                    type="button"
                    disabled={busyAction === `resolve:${entry.id}`}
                    onClick={async () => {
                      setBusyAction(`resolve:${entry.id}`);
                      await resolveMemoryConflict(entry.id, {
                        resolution: "keep_existing",
                        note: conflictNotes[entry.id],
                      });
                      setBusyAction(null);
                    }}
                    className="h-8 px-3 rounded border border-studio-border hover:bg-studio-ground text-[12px]"
                  >
                    {locale === "ar" ? "إبقاء الحالي" : "Keep Existing"}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction === `resolve:${entry.id}`}
                    onClick={async () => {
                      setBusyAction(`resolve:${entry.id}`);
                      await resolveMemoryConflict(entry.id, {
                        resolution: "keep_both",
                        note: conflictNotes[entry.id],
                      });
                      setBusyAction(null);
                    }}
                    className="h-8 px-3 rounded border border-studio-accent/40 text-studio-accent hover:bg-studio-accent-soft text-[12px]"
                  >
                    {locale === "ar" ? "الاحتفاظ بالاثنين" : "Keep Both"}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction === `resolve:${entry.id}`}
                    onClick={async () => {
                      setBusyAction(`resolve:${entry.id}`);
                      await resolveMemoryConflict(entry.id, {
                        resolution: "accept_new",
                        note: conflictNotes[entry.id],
                      });
                      setBusyAction(null);
                    }}
                    className="h-8 px-3.5 rounded-md bg-studio-emerald text-studio-ground hover:opacity-90 text-[12px] font-semibold"
                  >
                    {locale === "ar" ? "اعتماد الجديد وإلغاء القديم" : "Accept New & Supersede"}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* TAB 3: CONTROLLED LEARNING PIPELINE */}
      {tab === "learning" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleSubmitLearning(e)}
            className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-[14px] font-semibold text-studio-ink">
              <Sparkles className="w-4 h-4 text-studio-accent" />
              <span>
                {locale === "ar"
                  ? "إرسال تغذية راجعة لتطوير مهارات أو ذاكرة موظف (Feedback -> Reflection -> Diff -> Approval)"
                  : "Submit Feedback to Learning Pipeline (Feedback -> Reflection -> Diff -> Approval)"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-[12px]">
              <select
                aria-label="Learning Employee"
                value={learnEmpId}
                onChange={(e) => setLearnEmpId(e.target.value)}
                className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
              >
                {employees.map((emp) => (
                  <option key={emp.profile.id} value={emp.profile.id}>
                    {locale === "ar" ? emp.profile.nameAr : emp.profile.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Learning Rating"
                value={learnRating}
                onChange={(e) => setLearnRating(e.target.value as FeedbackRating)}
                className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
              >
                <option value="correction">correction</option>
                <option value="issue">issue</option>
                <option value="positive">positive</option>
              </select>

              <select
                aria-label="Learning Target"
                value={learnTargetKind}
                onChange={(e) => setLearnTargetKind(e.target.value as LearningTargetKind)}
                className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
              >
                <option value="employee_skill">target: employee_skill</option>
                <option value="memory_note">target: memory_note</option>
                <option value="employee_system">target: employee_system</option>
              </select>

              {learnTargetKind === "employee_skill" ? (
                <input
                  value={learnSkillName}
                  onChange={(e) => setLearnSkillName(e.target.value)}
                  placeholder="Skill name (e.g. core)"
                  className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              ) : learnTargetKind === "memory_note" ? (
                <select
                  value={learnScope}
                  onChange={(e) => setLearnScope(e.target.value as MemoryScope)}
                  className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                >
                  <option value="employee">scope: employee</option>
                  <option value="company">scope: company</option>
                  <option value="project">scope: project</option>
                </select>
              ) : (
                <div className="h-9 px-2.5 rounded border border-studio-border bg-studio-ground flex items-center font-mono text-studio-muted">
                  system.md
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <textarea
                required
                rows={2}
                value={learnFeedback}
                onChange={(e) => setLearnFeedback(e.target.value)}
                placeholder={
                  locale === "ar"
                    ? "ما الملاحظة أو الخطأ الذي حدث؟..."
                    : "Describe the feedback or correction..."
                }
                className="p-2.5 text-[13px] rounded border border-studio-border bg-studio-blueprint resize-none"
              />
              <textarea
                rows={2}
                value={learnExpected}
                onChange={(e) => setLearnExpected(e.target.value)}
                placeholder={
                  locale === "ar"
                    ? "القاعدة المتوقعة مستقبلاً (اختياري)..."
                    : "Expected behavior going forward (optional)..."
                }
                className="p-2.5 text-[13px] rounded border border-studio-border bg-studio-blueprint resize-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busyAction === "submit_learning"}
                className="h-9 px-4 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {locale === "ar"
                  ? "إنشاء مقترح وتقديمه للموافقة"
                  : "Generate Proposal & Queue Approval"}
              </button>
            </div>
          </form>

          {learnBanner && (
            <div
              className={`px-3 py-2 rounded-md border text-[12px] flex items-center justify-between gap-2 ${
                learnBanner.ok
                  ? "border-studio-emerald/35 bg-studio-emerald-soft text-studio-emerald"
                  : "border-studio-crimson/35 bg-studio-crimson-soft text-studio-crimson"
              }`}
            >
              <span>{learnBanner.text}</span>
              {learnBanner.ok && (
                <button
                  type="button"
                  onClick={() => setActiveView("approvals")}
                  className="px-2.5 py-1 rounded bg-studio-ink text-studio-surface text-[11px] font-semibold shrink-0"
                >
                  {t(locale, "navApprovals")} →
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-studio-ink">
              {locale === "ar" ? "سجل مقترحات التعلّم" : "Learning Proposals"}
            </h2>
            <div className="inline-flex p-0.5 rounded-md border border-studio-border bg-studio-surface">
              {(["ALL", "PENDING_APPROVAL", "APPLIED", "ROLLED_BACK", "REJECTED"] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setLearnFilter(st)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded ${
                      learnFilter === st
                        ? "bg-studio-ink text-studio-surface font-semibold"
                        : "text-studio-muted"
                    }`}
                  >
                    {st}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="space-y-3">
            {filteredProposals.map((prop) => {
              const emp = empMap.get(prop.employeeId);
              return (
                <article
                  key={prop.id}
                  className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-studio-ink">
                          {prop.proposedTitle}
                        </span>
                        <span
                          dir="ltr"
                          className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px]"
                        >
                          {prop.targetKind}
                        </span>
                        <span
                          dir="ltr"
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                            prop.status === "APPLIED"
                              ? "bg-studio-emerald-soft text-studio-emerald"
                              : prop.status === "PENDING_APPROVAL"
                                ? "bg-studio-amber-soft text-studio-amber"
                                : prop.status === "ROLLED_BACK"
                                  ? "bg-studio-ground text-studio-muted"
                                  : "bg-studio-crimson-soft text-studio-crimson"
                          }`}
                        >
                          {prop.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px] text-studio-muted">
                        {emp
                          ? locale === "ar"
                            ? emp.profile.nameAr
                            : emp.profile.name
                          : prop.employeeId}{" "}
                        ·{" "}
                        <span dir="ltr" className="font-mono">
                          {prop.targetFilePath}
                        </span>
                      </div>
                    </div>

                    <div dir="ltr" className="font-mono text-[11px] text-studio-ink font-semibold">
                      Eval: {prop.evaluation.score}/100
                    </div>
                  </div>

                  <p
                    dir="auto"
                    className="text-[12px] text-studio-muted whitespace-pre-wrap leading-relaxed"
                  >
                    {prop.reflection}
                  </p>

                  <div dir="ltr" className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                    {prop.evaluation.checks.map((chk) => (
                      <span
                        key={chk.name}
                        title={chk.detail}
                        className={`px-2 py-0.5 rounded ${
                          chk.passed
                            ? "bg-studio-emerald-soft text-studio-emerald"
                            : "bg-studio-crimson-soft text-studio-crimson"
                        }`}
                      >
                        {chk.passed ? "✓" : "✕"} {chk.name}
                      </span>
                    ))}
                  </div>

                  <UnifiedDiffViewer diff={prop.diffPreview} />

                  <div className="pt-2 border-t border-studio-border flex flex-wrap items-center justify-between gap-2">
                    <div dir="ltr" className="font-mono text-[11px] text-studio-muted">
                      id:{prop.id}
                      {prop.appliedAt ? ` · applied:${new Date(prop.appliedAt).toLocaleString()}` : ""}
                      {prop.rolledBackAt
                        ? ` · rolledBack:${new Date(prop.rolledBackAt).toLocaleString()}`
                        : ""}
                    </div>

                    <div className="flex items-center gap-2">
                      {prop.status === "PENDING_APPROVAL" && (
                        <button
                          type="button"
                          onClick={() => setActiveView("approvals")}
                          className="h-8 px-3 rounded bg-studio-amber text-white text-[12px] font-semibold"
                        >
                          {locale === "ar" ? "مراجعة في الموافقات" : "Review in Approvals"} →
                        </button>
                      )}
                      {prop.status === "APPLIED" && (
                        <>
                          {rollbackForceIds[prop.id] && (
                            <label className="text-[11px] text-studio-crimson flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={Boolean(rollbackForceIds[prop.id])}
                                onChange={(e) =>
                                  setRollbackForceIds((prev) => ({
                                    ...prev,
                                    [prop.id]: e.target.checked,
                                  }))
                                }
                              />
                              <span>Force override drift</span>
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={busyAction === `rollback:${prop.id}`}
                            onClick={() => void handleRollback(prop.id)}
                            className="h-8 px-3 rounded border border-studio-crimson/40 text-studio-crimson hover:bg-studio-crimson-soft text-[12px] font-semibold flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>
                              {locale === "ar" ? "تراجع فوري (Rollback)" : "1-Click Rollback"}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: VECTOR RETRIEVAL & DECAY SETTINGS */}
      {tab === "settings" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-[14px] font-semibold text-studio-ink">
              <Cpu className="w-4 h-4 text-studio-accent" />
              <span>
                {locale === "ar"
                  ? "سياسة البحث الدلالي والتقادم (Modular Vector & Decay)"
                  : "Vector Retrieval & Decay Lifecycle Policy"}
              </span>
            </div>

            <label className="flex items-center justify-between p-2.5 rounded border border-studio-border bg-studio-blueprint text-[13px]">
              <span>
                {locale === "ar"
                  ? "تفعيل البحث الدلالي عبر Ollama (اختياري)"
                  : "Enable Optional Ollama Vector Retrieval"}
              </span>
              <input
                type="checkbox"
                checked={policyDraft.vectorEnabled}
                onChange={(e) =>
                  setPolicyDraft((prev) => ({ ...prev, vectorEnabled: e.target.checked }))
                }
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px]">
              <div>
                <label className="block text-studio-muted mb-1">Ollama Base URL</label>
                <input
                  dir="ltr"
                  value={policyDraft.ollamaBaseUrl}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
              <div>
                <label className="block text-studio-muted mb-1">Embedding Model</label>
                <input
                  dir="ltr"
                  value={policyDraft.embeddingModel}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({ ...prev, embeddingModel: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
              <div>
                <label className="block text-studio-muted mb-1">FTS5 Weight</label>
                <input
                  dir="ltr"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={policyDraft.ftsWeight}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({ ...prev, ftsWeight: Number(e.target.value) }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
              <div>
                <label className="block text-studio-muted mb-1">Vector Weight</label>
                <input
                  dir="ltr"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={policyDraft.vectorWeight}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({ ...prev, vectorWeight: Number(e.target.value) }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
              <div>
                <label className="block text-studio-muted mb-1">
                  {locale === "ar" ? "نصف عمر التقادم (أيام)" : "Decay Half-Life (Days)"}
                </label>
                <input
                  dir="ltr"
                  type="number"
                  min="1"
                  max="3650"
                  value={policyDraft.decayHalfLifeDays}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({
                      ...prev,
                      decayHalfLifeDays: Number(e.target.value),
                    }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
              <div>
                <label className="block text-studio-muted mb-1">
                  {locale === "ar" ? "حد التلخيص التلقائي (رسائل)" : "Rolling Summary Threshold"}
                </label>
                <input
                  dir="ltr"
                  type="number"
                  min="2"
                  max="100"
                  value={policyDraft.rollingSummaryEveryMessages}
                  onChange={(e) =>
                    setPolicyDraft((prev) => ({
                      ...prev,
                      rollingSummaryEveryMessages: Number(e.target.value),
                    }))
                  }
                  className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                />
              </div>
            </div>

            {settingsMsg && (
              <div
                className={`px-3 py-2 rounded text-[12px] ${
                  settingsMsg.ok
                    ? "bg-studio-emerald-soft text-studio-emerald"
                    : "bg-studio-crimson-soft text-studio-crimson"
                }`}
              >
                {settingsMsg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={busyAction === "save_settings"}
              className="h-9 px-4 rounded-md bg-studio-ink text-studio-surface text-[12px] font-semibold"
            >
              {locale === "ar" ? "حفظ الإعدادات" : "Save Settings"}
            </button>
          </form>

          <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3">
            <div className="text-[14px] font-semibold text-studio-ink">
              {locale === "ar" ? "حالة الفهرسة المتجهية والتقادم" : "Vector Index & Decay Status"}
            </div>

            <div dir="ltr" className="grid grid-cols-2 gap-2.5 text-[12px] font-mono">
              <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                <div className="text-[10px] text-studio-muted">STATUS</div>
                <div className="mt-1 font-semibold text-studio-ink">
                  {vectorStatus?.status ?? "disabled"}
                </div>
              </div>
              <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                <div className="text-[10px] text-studio-muted">OLLAMA REACHABLE</div>
                <div className="mt-1 font-semibold text-studio-ink">
                  {vectorStatus?.ollamaReachable ? "yes" : "no (FTS5 fallback active)"}
                </div>
              </div>
              <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                <div className="text-[10px] text-studio-muted">INDEXED VECTORS</div>
                <div className="mt-1 font-semibold text-studio-ink">
                  {vectorStatus ? `${vectorStatus.indexedCount} / ${vectorStatus.totalActiveCount}` : "0 / 0"}
                </div>
              </div>
              <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                <div className="text-[10px] text-studio-muted">DIMENSIONS</div>
                <div className="mt-1 font-semibold text-studio-ink">
                  {vectorStatus?.dimensions ?? "n/a"}
                </div>
              </div>
            </div>

            <p className="text-[12px] text-studio-muted leading-relaxed">
              {locale === "ar"
                ? "يعمل النظام دائماً بملفات Markdown كـ Single Source of Truth وفهرسة SQLite FTS5 العربية/الإنجليزية. في حال إيقاف Ollama أو تعطيل البحث الدلالي، يستمر المكتب بكامل طاقته دون أي أعطال."
                : "Markdown remains the Single Source of Truth with normalized Arabic/English FTS5 always active. When Ollama is stopped or disabled, searches fall back to FTS5 with zero downtime."}
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyAction === "sync_vectors"}
                onClick={() => void handleSyncVectors()}
                className="h-9 px-3.5 rounded-md border border-studio-border hover:bg-studio-ground text-[12px] font-medium flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "مزامنة المتجهات" : "Sync Embeddings"}</span>
              </button>
              <button
                type="button"
                disabled={busyAction === "recalc_decay"}
                onClick={() => void handleRecalcDecay()}
                className="h-9 px-3.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "إعادة حساب التقادم" : "Recalculate Decay"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
