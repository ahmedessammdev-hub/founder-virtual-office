import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Download,
  GitBranch,
  GitCommitHorizontal,
  History,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { t } from "../../i18n/translations.ts";
import { officeApi } from "../../lib/api.ts";
import { useOfficeStore } from "../../store/office-store.ts";

type HubTab = "analytics" | "audit" | "backup";

export function AuditView() {
  const {
    locale,
    token,
    employees,
    projects,
    auditLogs,
    analytics,
    backupStatus,
    backupDiff,
    loadAnalytics,
    loadFilteredAudit,
    loadBackupStatus,
    initBackupRepo,
    createBackupSnapshot,
    loadBackupDiff,
    restoreBackupSnapshot,
  } = useOfficeStore();

  const [activeTab, setActiveTab] = useState<HubTab>("analytics");

  // --- Analytics state ---
  const [daysWindow, setDaysWindow] = useState(14);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // --- Audit Filter state ---
  const [actorFilter, setActorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [queryFilter, setQueryFilter] = useState("");
  const [loadingAudit, setLoadingAudit] = useState(false);

  // --- Git Backup state ---
  const [snapshotMsg, setSnapshotMsg] = useState("");
  const [busyBackup, setBusyBackup] = useState(false);
  const [confirmRestoreHash, setConfirmRestoreHash] = useState<string | null>(null);
  const [backupBanner, setBackupBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadAnalytics(daysWindow);
  }, [daysWindow, loadAnalytics]);

  useEffect(() => {
    void loadFilteredAudit({ limit: 150 });
    void loadBackupStatus();
  }, [loadFilteredAudit, loadBackupStatus]);

  const handleApplyAuditFilters = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAudit(true);
    try {
      await loadFilteredAudit({
        limit: 200,
        actorType: actorFilter || undefined,
        status: statusFilter || undefined,
        q: queryFilter.trim() || undefined,
      });
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(auditLogs, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "virtual-office-audit.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleInitRepo = async () => {
    setBusyBackup(true);
    setBackupBanner(null);
    try {
      await initBackupRepo();
      setBackupBanner({
        ok: true,
        text:
          locale === "ar"
            ? "تمت تهيئة مستودع Git داخل مجلد company/ وحفظ أول لقطة بنجاح."
            : "Initialized company/ Git backup repository with initial snapshot.",
      });
    } catch (err) {
      setBackupBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Git init failed",
      });
    } finally {
      setBusyBackup(false);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyBackup(true);
    setBackupBanner(null);
    try {
      const res = await createBackupSnapshot(snapshotMsg.trim() || undefined);
      setSnapshotMsg("");
      setBackupBanner({
        ok: true,
        text: res.created
          ? locale === "ar"
            ? "تم حفظ نسخة (Snapshot) جديدة بنجاح."
            : "Created new Git snapshot."
          : locale === "ar"
            ? "لا توجد تعديلات جديدة في company/ تستدعي حفظ نسخة."
            : "Working tree clean — no changes to commit.",
      });
    } catch (err) {
      setBackupBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Snapshot failed",
      });
    } finally {
      setBusyBackup(false);
    }
  };

  const handleRestore = async (commitHash: string) => {
    setBusyBackup(true);
    setBackupBanner(null);
    try {
      await restoreBackupSnapshot(commitHash);
      setConfirmRestoreHash(null);
      setBackupBanner({
        ok: true,
        text:
          locale === "ar"
            ? `تم الاسترجاع الآمن من النسخة ${commitHash.slice(0, 7)} وتحديث حالة المكتب والذاكرة.`
            : `Safely restored company/ from ${commitHash.slice(0, 7)} and synced workspace.`,
      });
    } catch (err) {
      setBackupBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Restore failed",
      });
    } finally {
      setBusyBackup(false);
    }
  };

  const empNameMap = new Map(
    employees.map((e) => [
      e.profile.id,
      locale === "ar" ? `${e.profile.nameAr} (${e.profile.id})` : `${e.profile.name} (${e.profile.id})`,
    ]),
  );
  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));

  // Pure SVG chart scaling
  const series = analytics?.dailySeries ?? [];
  const maxDailyRuns = Math.max(1, ...series.map((d) => d.runsCount));
  const maxDailyCost = Math.max(0.0001, ...series.map((d) => d.liveCostUsd));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {locale === "ar"
              ? "التحليلات، التدقيق الأمني، والنسخ الاحتياطي"
              : "Analytics, Security Audit & Git Backup"}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">
            {locale === "ar"
              ? "مراقبة الأداء والتكلفة الفعلية مقابل التجريبية، تصفية وتصدير سجل التدقيق، وإدارة نسخ Git الاحتياطية لمجلد company/."
              : "Track live vs mock spend and run health, filter/export redacted audit logs, and version-control company/ snapshots via Git."}
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl border border-studio-border bg-studio-surface gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              activeTab === "analytics"
                ? "bg-studio-subtle text-studio-ink"
                : "text-studio-muted hover:text-studio-ink"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{locale === "ar" ? "التحليلات والتكلفة" : "Analytics & Cost"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              activeTab === "audit"
                ? "bg-studio-subtle text-studio-ink"
                : "text-studio-muted hover:text-studio-ink"
            }`}
          >
            <ScrollText className="w-3.5 h-3.5" />
            <span>{locale === "ar" ? "سجل التدقيق الأمني" : "Audit Log"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("backup")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              activeTab === "backup"
                ? "bg-studio-subtle text-studio-ink"
                : "text-studio-muted hover:text-studio-ink"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>{locale === "ar" ? "النسخ الاحتياطي Git" : "Git Backup"}</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ANALYTICS */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-studio-border bg-studio-surface p-0.5 text-[12px]">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysWindow(d)}
                  className={`px-3 py-1 rounded-md font-mono transition-colors ${
                    daysWindow === d
                      ? "bg-studio-subtle text-studio-ink font-semibold"
                      : "text-studio-muted hover:text-studio-ink"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={loadingAnalytics}
              onClick={async () => {
                setLoadingAnalytics(true);
                try {
                  await loadAnalytics(daysWindow);
                } finally {
                  setLoadingAnalytics(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-studio-border bg-studio-surface text-[12px] hover:border-studio-accent"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? "animate-spin" : ""}`} />
              <span>{locale === "ar" ? "تحديث البيانات" : "Refresh"}</span>
            </button>
          </div>

          {analytics && (
            <>
              {/* Executive Headline Finding + Baseline Delta */}
              {(() => {
                const topEmp = analytics.byEmployee[0];
                const topEmpLabel = topEmp
                  ? empNameMap.get(topEmp.employeeId) ?? topEmp.employeeId
                  : null;
                const delta = analytics.baselineDelta;
                return (
                  <div className="bg-studio-surface border border-studio-border rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                    <div className="text-studio-ink font-medium" dir="auto">
                      {locale === "ar"
                        ? analytics.totals.totalRuns === 0
                          ? `لا توجد عمليات تشغيل مسجلة خلال آخر ${analytics.daysWindow} يوماً — ابدأ بإرسال مهمة من المكتب أو في وضع Mock.`
                          : `نسبة النجاح ${analytics.totals.successRatePct}% من إجمالي ${analytics.totals.totalRuns} مهمة${
                              topEmpLabel ? ` · الأكثر نشاطاً: ${topEmpLabel}` : ""
                            } · الإنفاق الفعلي $${analytics.totals.liveTotalUsd.toFixed(4)}.`
                        : analytics.totals.totalRuns === 0
                          ? `No runs recorded in the last ${analytics.daysWindow} days — dispatch a task from the office or test in Mock mode.`
                          : `${analytics.totals.successRatePct}% completion across ${analytics.totals.totalRuns} runs${
                              topEmpLabel ? ` · Most active: ${topEmpLabel}` : ""
                            } · Live spend $${analytics.totals.liveTotalUsd.toFixed(4)}.`}
                    </div>
                    {delta && (
                      <div dir="ltr" className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                        <span
                          className={`px-2 py-0.5 rounded border border-studio-border bg-studio-ground ${
                            delta.runsDeltaPct >= 0 ? "text-studio-emerald" : "text-studio-amber"
                          }`}
                        >
                          Runs {delta.runsDeltaPct >= 0 ? "+" : ""}
                          {delta.runsDeltaPct}% vs prev {analytics.daysWindow}d
                        </span>
                        <span className="px-2 py-0.5 rounded border border-studio-border bg-studio-ground text-studio-muted">
                          Success {delta.successRateDeltaPts >= 0 ? "+" : ""}
                          {delta.successRateDeltaPts} pts
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* KPI Strip */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 bg-studio-surface border border-studio-border rounded-xl divide-y md:divide-y-0 md:divide-x md:rtl:divide-x-reverse divide-studio-border">
                <div className="p-4 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-studio-muted">
                    {locale === "ar" ? "إجمالي المهام" : "Total Runs"}
                  </div>
                  <div dir="ltr" className="text-[22px] font-semibold font-mono tabular-nums text-studio-ink">
                    {analytics.totals.totalRuns}
                  </div>
                  <div dir="ltr" className="text-[11px] font-mono tabular-nums text-studio-emerald">
                    {analytics.totals.successRatePct}% success · {analytics.totals.avgDurationMs}ms avg
                  </div>
                </div>

                <div className="p-4 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-studio-muted">
                    {locale === "ar" ? "التكلفة الفعلية (Live)" : "Live Spend (Window)"}
                  </div>
                  <div dir="ltr" className="text-[22px] font-semibold font-mono tabular-nums text-studio-ink">
                    ${analytics.totals.liveTotalUsd.toFixed(4)}
                  </div>
                  <div dir="ltr" className="text-[11px] font-mono tabular-nums text-studio-muted">
                    Today: ${analytics.totals.liveTodayUsd.toFixed(4)}
                  </div>
                </div>

                <div className="p-4 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-studio-muted">
                    {locale === "ar" ? "استهلاك المحاكاة / Mock" : "Mock / Dry-Run Spend"}
                  </div>
                  <div dir="ltr" className="text-[22px] font-semibold font-mono tabular-nums text-studio-muted">
                    ${analytics.totals.mockTotalUsd.toFixed(4)}
                  </div>
                  <div className="text-[11px] text-studio-muted">
                    {locale === "ar" ? "معزول عن الميزانية الفعلية" : "Isolated from live caps"}
                  </div>
                </div>

                <div className="p-4 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-studio-muted">
                    {locale === "ar" ? "إجمالي التوكنز" : "Total Tokens"}
                  </div>
                  <div dir="ltr" className="text-[22px] font-semibold font-mono tabular-nums text-studio-ink">
                    {(analytics.totals.totalInputTokens + analytics.totals.totalOutputTokens).toLocaleString()}
                  </div>
                  <div dir="ltr" className="text-[11px] font-mono tabular-nums text-studio-muted">
                    in {analytics.totals.totalInputTokens.toLocaleString()} / out{" "}
                    {analytics.totals.totalOutputTokens.toLocaleString()}
                  </div>
                </div>

                <div className="p-4 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-studio-muted">
                    {locale === "ar" ? "الحوكمة والأمان" : "Governance & Security"}
                  </div>
                  <div dir="ltr" className="text-[22px] font-semibold font-mono tabular-nums text-studio-amber">
                    {analytics.totals.pendingApprovals}{" "}
                    <span className="text-[12px] text-studio-muted font-normal">pending</span>
                  </div>
                  <div dir="ltr" className="text-[11px] font-mono tabular-nums text-studio-crimson">
                    {analytics.totals.deniedAuditEvents} denied · {analytics.totals.rateLimitedEvents} rate-cap
                  </div>
                </div>
              </div>

              {/* Pure SVG Daily Runs & Live Cost Chart */}
              <div className="bg-studio-surface border border-studio-border rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[13.5px] font-semibold text-studio-ink flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-studio-accent" />
                    <span>
                      {locale === "ar"
                        ? `النشاط اليومي والإنفاق الفعلي (آخر ${analytics.daysWindow} يوماً)`
                        : `Daily Execution & Live Spend (${analytics.daysWindow}-Day Window)`}
                    </span>
                  </h2>
                  <div className="flex items-center gap-4 text-[11px]" dir="ltr">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-studio-accent inline-block" /> Runs
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-studio-emerald inline-block" /> Live Spend ($)
                    </span>
                  </div>
                </div>

                <div dir="ltr" className="overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${Math.max(560, series.length * 44 + 40)} 170`}
                    className="w-full h-44 min-w-[540px]"
                    role="img"
                    aria-label="Daily Runs and Spend Bar Chart"
                  >
                    <line x1="20" y1="130" x2={Math.max(540, series.length * 44 + 20)} y2="130" stroke="rgb(var(--studio-border-strong))" />
                    {series.map((pt, idx) => {
                      const x = 28 + idx * 44;
                      const runsH = pt.runsCount > 0 ? Math.max(6, Math.round((pt.runsCount / maxDailyRuns) * 96)) : 0;
                      const costH = pt.liveCostUsd > 0 ? Math.max(4, Math.round((pt.liveCostUsd / maxDailyCost) * 96)) : 0;
                      return (
                        <g key={pt.day}>
                          <title>{`${pt.day}: ${pt.runsCount} runs (${pt.completedCount} ok, ${pt.failedCount} failed) · Live $${pt.liveCostUsd.toFixed(4)}`}</title>
                          {runsH > 0 && (
                            <rect
                              x={x}
                              y={130 - runsH}
                              width="14"
                              height={runsH}
                              rx="2"
                              fill="rgb(var(--studio-accent))"
                            />
                          )}
                          {costH > 0 && (
                            <rect
                              x={x + 17}
                              y={130 - costH}
                              width="12"
                              height={costH}
                              rx="2"
                              fill="rgb(var(--studio-emerald))"
                            />
                          )}
                          <text
                            x={x + 14}
                            y="148"
                            textAnchor="middle"
                            fill="rgb(var(--studio-muted))"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {pt.day.slice(5)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Breakdown Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* By Employee */}
                <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5 overflow-x-auto">
                  <h3 className="text-[13.5px] font-semibold text-studio-ink">
                    {locale === "ar" ? "الأداء والتكلفة حسب الموظف" : "Breakdown by Employee"}
                  </h3>
                  <table className="w-full text-[12px]">
                    <thead className="border-b border-studio-border text-studio-muted">
                      <tr>
                        <th className="text-start py-1.5 px-2 font-medium">Employee</th>
                        <th className="text-end py-1.5 px-2 font-medium">Runs</th>
                        <th className="text-end py-1.5 px-2 font-medium">Live $</th>
                        <th className="text-end py-1.5 px-2 font-medium">Mock $</th>
                        <th className="text-end py-1.5 px-2 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-studio-border">
                      {analytics.byEmployee.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-studio-muted">
                            —
                          </td>
                        </tr>
                      ) : (
                        analytics.byEmployee.map((row) => (
                          <tr key={row.employeeId}>
                            <td className="py-1.5 px-2 font-medium">
                              {empNameMap.get(row.employeeId) ?? row.employeeId}
                            </td>
                            <td dir="ltr" className="py-1.5 px-2 font-mono tabular-nums text-end">
                              {row.runsCount} ({row.completedCount}/{row.failedCount})
                            </td>
                            <td dir="ltr" className="py-1.5 px-2 font-mono tabular-nums text-end">
                              ${row.liveCostUsd.toFixed(4)}
                            </td>
                            <td dir="ltr" className="py-1.5 px-2 font-mono tabular-nums text-end text-studio-muted">
                              ${row.mockCostUsd.toFixed(4)}
                            </td>
                            <td dir="ltr" className="py-1.5 px-2 font-mono tabular-nums text-end text-studio-muted">
                              {(row.inputTokens + row.outputTokens).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* By Provider & Mode + By Project */}
                <div className="space-y-4">
                  <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5 overflow-x-auto">
                    <h3 className="text-[13.5px] font-semibold text-studio-ink">
                      {locale === "ar" ? "التوزيع حسب المزوّد ووضع التشغيل" : "By Provider & Mode"}
                    </h3>
                    <table className="w-full text-[12px]">
                      <thead className="border-b border-studio-border text-studio-muted">
                        <tr>
                          <th className="text-start py-1.5 px-2 font-medium">Provider</th>
                          <th className="text-start py-1.5 px-2 font-medium">Mode</th>
                          <th className="text-start py-1.5 px-2 font-medium">Runs</th>
                          <th className="text-start py-1.5 px-2 font-medium">Cost $</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-studio-border">
                        {analytics.byProvider.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-3 text-center text-studio-muted">
                              —
                            </td>
                          </tr>
                        ) : (
                          analytics.byProvider.map((p) => (
                            <tr key={`${p.provider}-${p.mode}`}>
                              <td dir="ltr" className="py-1.5 px-2 font-mono font-semibold">
                                {p.provider}
                              </td>
                              <td dir="ltr" className="py-1.5 px-2 font-mono">
                                {p.mode}
                              </td>
                              <td dir="ltr" className="py-1.5 px-2 font-mono">
                                {p.runsCount}
                              </td>
                              <td dir="ltr" className="py-1.5 px-2 font-mono">
                                ${p.costUsd.toFixed(4)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5 overflow-x-auto">
                    <h3 className="text-[13.5px] font-semibold text-studio-ink">
                      {locale === "ar" ? "المشاريع وإشارات الحماية" : "Projects & Security Signals"}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {analytics.byProject.map((proj) => (
                        <span
                          key={proj.projectId}
                          dir="ltr"
                          className="px-2.5 py-1 rounded border border-studio-border bg-studio-ground font-mono text-[11px]"
                        >
                          {proj.projectId === "__company__"
                            ? "HQ"
                            : projectNameMap.get(proj.projectId) ?? proj.projectId}
                          : {proj.runsCount} runs · ${proj.liveCostUsd.toFixed(4)}
                        </span>
                      ))}
                      {analytics.securitySignals.map((sig) => (
                        <span
                          key={`${sig.action}-${sig.status}`}
                          dir="ltr"
                          className="px-2.5 py-1 rounded border border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson font-mono text-[11px]"
                        >
                          {sig.action} [{sig.status}] × {sig.count}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: AUDIT LOG FILTER & EXPORT */}
      {activeTab === "audit" && (
        <div className="space-y-3">
          <div className="text-[12.5px] text-studio-muted">{t(locale, "auditQuestion")}</div>

          <form
            onSubmit={handleApplyAuditFilters}
            className="bg-studio-surface border border-studio-border rounded-lg p-3 flex flex-wrap items-center justify-between gap-2.5 text-[12px]"
          >
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <select
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint"
              >
                <option value="">{locale === "ar" ? "كل الجهات" : "All Actors"}</option>
                <option value="human">human</option>
                <option value="employee">employee</option>
                <option value="system">system</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint"
              >
                <option value="">{locale === "ar" ? "كل الحالات" : "All Statuses"}</option>
                <option value="OK">OK</option>
                <option value="DENIED">DENIED</option>
                <option value="BLOCKED">BLOCKED</option>
                <option value="ERROR">ERROR</option>
              </select>

              <input
                value={queryFilter}
                onChange={(e) => setQueryFilter(e.target.value)}
                dir="auto"
                placeholder={locale === "ar" ? "بحث بالإجراء أو الهدف…" : "Search action/target…"}
                className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint"
              />

              <button
                type="submit"
                disabled={loadingAudit}
                className="px-3 py-1.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 font-medium"
              >
                {locale === "ar" ? "تصفية" : "Filter"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (token) {
                    void officeApi.downloadAuditCsv(token, {
                      limit: 500,
                      actorType: actorFilter || undefined,
                      status: statusFilter || undefined,
                      q: queryFilter.trim() || undefined,
                    });
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-studio-border bg-studio-ground hover:border-studio-accent"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "تصدير CSV" : "Export CSV"}</span>
              </button>

              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-studio-border bg-studio-ground hover:border-studio-accent"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "تصدير JSON" : "Export JSON"}</span>
              </button>
            </div>
          </form>

          <div className="bg-studio-surface border border-studio-border rounded-lg overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-studio-border text-studio-muted">
                  <th className="py-2.5 px-3 font-medium text-start">Time</th>
                  <th className="py-2.5 px-3 font-medium text-start">Actor</th>
                  <th className="py-2.5 px-3 font-medium text-start">Action</th>
                  <th className="py-2.5 px-3 font-medium text-start">Target</th>
                  <th className="py-2.5 px-3 font-medium text-start">Status</th>
                  <th className="py-2.5 px-3 font-medium text-start">Details (Redacted)</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 px-3 text-center text-studio-muted">
                      —
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="border-b border-studio-border last:border-0 align-top">
                      <td className="py-2 px-3 font-mono text-[11px] text-studio-muted whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px]">
                        {log.actorType}:{log.actorId}
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold text-studio-ink">
                        {log.action}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-studio-muted">
                        {log.targetType ? `${log.targetType}:${log.targetId}` : "—"}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px]">
                        <span
                          className={
                            log.status === "DENIED" || log.status === "BLOCKED"
                              ? "px-1.5 py-0.5 rounded bg-studio-crimson-soft text-studio-crimson font-semibold"
                              : ""
                          }
                        >
                          {log.status}
                        </span>
                      </td>
                      <td
                        dir="ltr"
                        className="py-2 px-3 font-mono text-[11px] text-studio-muted max-w-sm break-all"
                      >
                        {log.details ? JSON.stringify(log.details) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: GIT BACKUP & PORTABLE EXPORT */}
      {activeTab === "backup" && (
        <div className="space-y-4">
          {backupBanner && (
            <div
              className={`px-3 py-2 rounded-md border text-[12.5px] flex items-center gap-2 ${
                backupBanner.ok
                  ? "border-studio-emerald/30 bg-studio-emerald-soft text-studio-emerald"
                  : "border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson"
              }`}
            >
              {backupBanner.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              )}
              <span dir="auto">{backupBanner.text}</span>
            </div>
          )}

          <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-[14px] font-semibold text-studio-ink flex items-center gap-1.5">
                  <GitCommitHorizontal className="w-4 h-4 text-studio-accent" />
                  <span>
                    {locale === "ar"
                      ? "إدارة نسخ مجلد الشركة (company/ Git Backup)"
                      : "Company Workspace Version Control & Export"}
                  </span>
                </h2>
                <p className="text-[12px] text-studio-muted">
                  {locale === "ar"
                    ? "يغطي مجلد company/ فقط (المخطط، الموظفين، المشاريع، والذاكرة) مع استبعاد تام لأسرار data/vault.enc.json."
                    : "Tracks company/ files only (floorplan, roles, projects, memory) and never includes encrypted data/vault.enc.json secrets."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (token) void officeApi.downloadBackupExport(token);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-studio-border bg-studio-ground text-[12px] font-medium hover:border-studio-accent"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "تصدير حزمة JSON محمولة" : "Export JSON Bundle"}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-mono" dir="ltr">
              <span
                className={`px-2 py-0.5 rounded ${
                  backupStatus?.initialized
                    ? "bg-studio-emerald-soft text-studio-emerald"
                    : "bg-studio-ground text-studio-muted"
                }`}
              >
                {backupStatus?.initialized ? "git: initialized" : "git: uninitialized"}
              </span>
              {backupStatus?.branch && (
                <span className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border">
                  branch: {backupStatus.branch}
                </span>
              )}
              {backupStatus?.headHash && (
                <span className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border">
                  HEAD: {backupStatus.headHash.slice(0, 7)}
                </span>
              )}
              {backupStatus?.initialized && (
                <span className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border">
                  dirty files: {backupStatus.dirtyCount}
                </span>
              )}
            </div>

            {!backupStatus?.initialized ? (
              <div className="pt-1">
                <button
                  type="button"
                  disabled={busyBackup}
                  onClick={() => void handleInitRepo()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12.5px] font-medium disabled:opacity-50"
                >
                  <GitBranch className="w-4 h-4" />
                  <span>
                    {busyBackup
                      ? locale === "ar"
                        ? "جارٍ التهيئة…"
                        : "Initializing…"
                      : locale === "ar"
                        ? "تهيئة مستودع Git وحفظ اللقطة الأولى"
                        : "Initialize Git Backup & Commit First Snapshot"}
                  </span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateSnapshot} className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  value={snapshotMsg}
                  onChange={(e) => setSnapshotMsg(e.target.value)}
                  dir="auto"
                  placeholder={
                    locale === "ar"
                      ? "وصف النسخة الاحتياطية (اختياري)…"
                      : "Optional snapshot commit message…"
                  }
                  className="flex-1 min-w-[220px] px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint text-[13px]"
                />
                <button
                  type="submit"
                  disabled={busyBackup}
                  className="px-3.5 py-1.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12.5px] font-medium disabled:opacity-50"
                >
                  {locale === "ar" ? "حفظ نسخة (Snapshot)" : "Create Snapshot"}
                </button>
                <button
                  type="button"
                  disabled={busyBackup}
                  onClick={() => void loadBackupDiff()}
                  className="px-3 py-1.5 rounded border border-studio-border bg-studio-ground text-[12px] hover:border-studio-accent"
                >
                  {locale === "ar" ? "عرض التعديلات الحالية (Diff)" : "Inspect Working Diff"}
                </button>
              </form>
            )}
          </div>

          {backupDiff && (
            <div className="bg-studio-surface border border-studio-border rounded-lg p-3 space-y-1.5">
              <div className="text-[12px] font-semibold text-studio-ink">Git Diff</div>
              <pre
                dir="ltr"
                className="p-2.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px] max-h-64 overflow-auto whitespace-pre-wrap"
              >
                {backupDiff}
              </pre>
            </div>
          )}

          {backupStatus?.initialized && (
            <div className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5">
              <h3 className="text-[13.5px] font-semibold text-studio-ink flex items-center gap-1.5">
                <History className="w-4 h-4 text-studio-accent" />
                <span>{locale === "ar" ? "تاريخ النسخ المحفوظة" : "Snapshot Commit History"}</span>
              </h3>

              {backupStatus.commits.length === 0 ? (
                <div className="text-[12.5px] text-studio-muted">No commits yet.</div>
              ) : (
                <div className="divide-y divide-studio-border">
                  {backupStatus.commits.map((c) => (
                    <div
                      key={c.hash}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px]"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span dir="ltr" className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-studio-ground border border-studio-border">
                            {c.shortHash}
                          </span>
                          <span className="font-medium text-studio-ink" dir="auto">
                            {c.message}
                          </span>
                        </div>
                        <div dir="ltr" className="font-mono text-[11px] text-studio-muted">
                          {c.author} · {new Date(c.dateIso).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void loadBackupDiff(c.hash)}
                          className="px-2.5 py-1 rounded border border-studio-border bg-studio-ground text-[11.5px] hover:border-studio-accent"
                        >
                          Diff
                        </button>
                        {confirmRestoreHash === c.hash ? (
                          <button
                            type="button"
                            disabled={busyBackup}
                            onClick={() => void handleRestore(c.hash)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-studio-crimson text-white text-[11.5px] font-medium"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{locale === "ar" ? "تأكيد الاسترجاع" : "Confirm Restore"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyBackup}
                            onClick={() => setConfirmRestoreHash(c.hash)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-studio-border bg-studio-surface text-[11.5px] hover:border-studio-crimson hover:text-studio-crimson"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{locale === "ar" ? "استرجاع آمن" : "Safe Restore"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
