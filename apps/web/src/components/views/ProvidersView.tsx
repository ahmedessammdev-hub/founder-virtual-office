import React, { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Shield, Trash2 } from "lucide-react";
import { t } from "../../i18n/translations.ts";
import { useOfficeStore } from "../../store/office-store.ts";

const PRESET_SECRET_KEYS = [
  { key: "GEMINI_API_KEY", providerHint: "gemini_api" },
  { key: "OPENAI_API_KEY", providerHint: "openai_api" },
  { key: "ANTHROPIC_API_KEY", providerHint: "anthropic_api" },
  { key: "OPENROUTER_API_KEY", providerHint: "openrouter_api" },
  { key: "GITHUB_TOKEN", providerHint: "github" },
];

export function ProvidersView() {
  const {
    locale,
    providers,
    usage,
    employees,
    vaultKeys,
    companyPolicies,
    refreshProviders,
    loadVaultAndPolicies,
    saveVaultKey,
    deleteVaultKey,
    updatePolicies,
  } = useOfficeStore();

  const [refreshing, setRefreshing] = useState(false);
  const [secretKey, setSecretKey] = useState("GEMINI_API_KEY");
  const [secretValue, setSecretValue] = useState("");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [savingSecret, setSavingSecret] = useState(false);

  const [taskBudget, setTaskBudget] = useState("1.5");
  const [dailyBudget, setDailyBudget] = useState("15");
  const [maxConcurrent, setMaxConcurrent] = useState("2");
  const [allowPaidFallback, setAllowPaidFallback] = useState(false);
  const [policyStatus, setPolicyStatus] = useState<string | null>(null);

  useEffect(() => {
    void loadVaultAndPolicies();
  }, []);

  useEffect(() => {
    if (companyPolicies?.budgets) {
      setTaskBudget(String(companyPolicies.budgets.defaultTaskBudgetUsd));
      setDailyBudget(String(companyPolicies.budgets.defaultDailyBudgetUsd));
      setMaxConcurrent(String(companyPolicies.budgets.maxConcurrentRuns));
      setAllowPaidFallback(Boolean(companyPolicies.budgets.allowPaidFallback));
    }
  }, [companyPolicies?.budgets]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProviders();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultError(null);
    setSavingSecret(true);
    try {
      const hint = PRESET_SECRET_KEYS.find((k) => k.key === secretKey)?.providerHint;
      await saveVaultKey(secretKey.trim(), secretValue, hint);
      setSecretValue("");
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingSecret(false);
    }
  };

  const handleSaveBudgets = async (e: React.FormEvent) => {
    e.preventDefault();
    await updatePolicies({
      budgets: {
        defaultTaskBudgetUsd: Math.max(0.05, Number(taskBudget) || 1.5),
        defaultDailyBudgetUsd: Math.max(0.5, Number(dailyBudget) || 15),
        maxConcurrentRuns: Math.max(1, Math.min(8, Math.round(Number(maxConcurrent) || 2))),
        allowPaidFallback,
      },
    });
    setPolicyStatus(locale === "ar" ? "تم حفظ سياسة الميزانية والـ Fallback." : "Budget policy saved.");
    setTimeout(() => setPolicyStatus(null), 3000);
  };

  const empMap = new Map(employees.map((e) => [e.profile.id, e]));

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {t(locale, "providersTitle")}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">{t(locale, "providersQuestion")}</p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          className="h-8 px-3 rounded-md border border-studio-border bg-studio-surface hover:bg-studio-ground text-[12px] font-medium flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span>{t(locale, "refreshHealthBtn")}</span>
        </button>
      </div>

      {/* Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {providers.map((p) => (
          <div
            key={p.provider}
            className="p-3.5 bg-studio-surface border border-studio-border rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[13px] font-semibold text-studio-ink">
                {p.provider}
              </span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                  p.available
                    ? "bg-studio-emerald-soft text-studio-emerald"
                    : p.installed
                      ? "bg-studio-amber-soft text-studio-amber"
                      : "bg-studio-ground text-studio-muted"
                }`}
              >
                {p.available ? "READY" : p.installed ? "OFFLINE / UNCONFIGURED" : "NOT INSTALLED"}
              </span>
            </div>

            <div className="text-[12px] text-studio-muted">{p.message ?? "—"}</div>

            <div dir="ltr" className="text-[11px] font-mono text-studio-muted flex flex-wrap items-center justify-between gap-2">
              <span>auth: {p.authStatus}</span>
              {p.version && <span>{p.version}</span>}
            </div>

            {p.models.length > 0 && (
              <div dir="ltr" className="pt-1 flex flex-wrap gap-1 items-center">
                {p.models.slice(0, 4).map((m) => (
                  <span
                    key={m}
                    className="px-1.5 py-0.5 rounded bg-studio-blueprint border border-studio-border font-mono text-[10px]"
                  >
                    {m}
                  </span>
                ))}
                {p.models.length > 4 && (
                  <span className="text-[10px] font-mono text-studio-muted px-1">
                    +{p.models.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Encrypted Credential Vault + Budget & Fallback Governance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-studio-accent" />
              <h2 className="text-[14px] font-semibold text-studio-ink">
                {locale === "ar" ? "خزنة المفاتيح المشفّرة (Encrypted Vault)" : "Encrypted API Keys Vault"}
              </h2>
            </div>
            <span className="text-[10px] font-mono text-studio-muted">AES-256-GCM · DPAPI</span>
          </div>

          <form onSubmit={handleSaveSecret} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                list="vault-preset-keys"
                dir="ltr"
                required
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="GEMINI_API_KEY"
                className="h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              />
              <datalist id="vault-preset-keys">
                {PRESET_SECRET_KEYS.map((k) => (
                  <option key={k.key} value={k.key} />
                ))}
              </datalist>

              <input
                type="password"
                dir="ltr"
                required
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder="sk-... / AIza..."
                className="h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              />
            </div>

            {vaultError && <div className="text-[12px] text-studio-crimson">{vaultError}</div>}

            <button
              type="submit"
              disabled={savingSecret || !secretValue.trim()}
              className="h-8 px-3.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium disabled:opacity-50"
            >
              {savingSecret ? "..." : locale === "ar" ? "حفظ وتشفير المفتاح" : "Encrypt & Save Key"}
            </button>
          </form>

          <div className="border-t border-studio-border pt-2.5 space-y-1.5">
            {vaultKeys.length === 0 ? (
              <div className="text-[12px] text-studio-muted">
                {locale === "ar"
                  ? "لا توجد مفاتيح محفوظة في الخزنة حالياً."
                  : "No secrets saved in Vault yet."}
              </div>
            ) : (
              vaultKeys.map((item) => (
                <div
                  key={item.key}
                  className="px-2.5 py-1.5 rounded border border-studio-border bg-studio-blueprint flex items-center justify-between gap-2 text-[12px]"
                >
                  <div dir="ltr" className="font-mono">
                    <span className="font-semibold text-studio-ink">{item.key}</span>
                    <span className="text-studio-muted ms-2">{item.maskedValue}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteVaultKey(item.key)}
                    className="p-1 text-studio-faint hover:text-studio-crimson"
                    title="Delete key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-studio-emerald" />
            <h2 className="text-[14px] font-semibold text-studio-ink">
              {locale === "ar" ? "حوكمة الميزانية والانتقال الاحتياطي (Fallback)" : "Budget & Fallback Governance"}
            </h2>
          </div>

          <form onSubmit={handleSaveBudgets} className="space-y-3">
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-studio-muted mb-1">Task Cap ($)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.05"
                  dir="ltr"
                  value={taskBudget}
                  onChange={(e) => setTaskBudget(e.target.value)}
                  className="w-full h-8 px-2 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                />
              </div>
              <div>
                <label className="block text-[11px] text-studio-muted mb-1">Daily Cap ($)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  dir="ltr"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  className="w-full h-8 px-2 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                />
              </div>
              <div>
                <label className="block text-[11px] text-studio-muted mb-1">Max Concurrent</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  dir="ltr"
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(e.target.value)}
                  className="w-full h-8 px-2 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-studio-ink cursor-pointer">
              <input
                type="checkbox"
                checked={allowPaidFallback}
                onChange={(e) => setAllowPaidFallback(e.target.checked)}
              />
              <span>
                {locale === "ar"
                  ? "السماح بالانتقال التلقائي لمزود Direct API مدفوع عند أخطاء Rate Limit"
                  : "Allow automatic fallback to paid Direct APIs on transient rate limits"}
              </span>
            </label>

            <div className="flex items-center justify-between">
              <span className="text-[12px] text-studio-emerald">{policyStatus ?? ""}</span>
              <button
                type="submit"
                className="h-8 px-3.5 rounded bg-studio-ink text-studio-surface text-[12px] font-medium"
              >
                {locale === "ar" ? "حفظ الإعدادات" : "Save Governance"}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Honest Usage Ledger Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-studio-surface border border-studio-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-studio-border text-[13px] font-semibold">
            {locale === "ar" ? "الاستهلاك الفعلي حسب الموظف (Live)" : "Live Spend by Employee"}
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-studio-border text-studio-muted text-start">
                <th className="py-2 px-3 font-medium text-start">Employee</th>
                <th className="py-2 px-3 font-medium text-end">Tokens</th>
                <th className="py-2 px-3 font-medium text-end">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.byEmployee.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 px-3 text-center text-studio-muted">
                    {locale === "ar"
                      ? "لا يوجد استهلاك فعلي (Live) مسجّل بعد"
                      : "No live spend recorded yet"}
                  </td>
                </tr>
              ) : (
                usage?.byEmployee.map((row) => {
                  const emp = empMap.get(row.employeeId);
                  return (
                    <tr key={row.employeeId} className="border-b border-studio-border last:border-0">
                      <td className="py-2 px-3">
                        {emp ? (locale === "ar" ? emp.profile.nameAr : emp.profile.name) : row.employeeId}
                      </td>
                      <td className="py-2 px-3 text-end font-mono tabular-nums">
                        {(row.inputTokens + row.outputTokens).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-end font-mono tabular-nums">
                        ${row.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-studio-surface border border-studio-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-studio-border text-[13px] font-semibold">
            {locale === "ar" ? "المزودات حسب الوضع (Live / Dry-Run / Mock)" : "Usage by Provider & Mode"}
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-studio-border text-studio-muted">
                <th className="py-2 px-3 font-medium text-start">Provider</th>
                <th className="py-2 px-3 font-medium text-start">Mode</th>
                <th className="py-2 px-3 font-medium text-end">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.byProvider.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 px-3 text-center text-studio-muted">
                    —
                  </td>
                </tr>
              ) : (
                usage?.byProvider.map((row, i) => (
                  <tr key={i} className="border-b border-studio-border last:border-0">
                    <td className="py-2 px-3 font-mono">{row.provider}</td>
                    <td className="py-2 px-3 font-mono">{row.mode}</td>
                    <td className="py-2 px-3 text-end font-mono tabular-nums">
                      ${row.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
