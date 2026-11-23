import React, { useEffect, useState } from "react";
import { Globe, Play, Plug, Plus, Shield, Trash2 } from "lucide-react";
import type { McpTransport, RiskTier } from "@virtual-office/shared";
import type { McpTestResult } from "../../lib/api.ts";
import { useOfficeStore } from "../../store/office-store.ts";

export function McpManagerView() {
  const {
    locale,
    mcpServers,
    mcpTemplates,
    companyPolicies,
    loadMcps,
    upsertMcp,
    patchMcp,
    deleteMcp,
    testMcp,
    updatePolicies,
  } = useOfficeStore();

  useEffect(() => {
    void loadMcps();
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [envVaultKeysText, setEnvVaultKeysText] = useState("");
  const [defaultRiskTier, setDefaultRiskTier] = useState<RiskTier>("tier1_auto");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const [allowlistText, setAllowlistText] = useState("");
  const [browserEnabled, setBrowserEnabled] = useState(true);
  const [policySavedMsg, setPolicySavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (companyPolicies?.security) {
      setBrowserEnabled(companyPolicies.security.enabled);
      setAllowlistText(companyPolicies.security.domainAllowlist.join(", "));
    }
  }, [companyPolicies?.security]);

  const applyTemplate = (tplId: string) => {
    const tpl = mcpTemplates.find((item) => item.id === tplId);
    if (!tpl) return;
    setId(tpl.config.id);
    setName(tpl.config.name);
    setDescription(tpl.config.description ?? "");
    setTransport(tpl.config.transport);
    setCommand(tpl.config.command ?? "npx");
    setArgsText((tpl.config.args ?? []).join(" "));
    setUrl(tpl.config.url ?? "");
    setEnvVaultKeysText((tpl.config.envVaultKeys ?? []).join(", "));
    setDefaultRiskTier(tpl.config.defaultRiskTier ?? "tier1_auto");
    setShowForm(true);
    setFormErr(null);
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    try {
      await upsertMcp({
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        transport,
        command: transport === "stdio" ? command.trim() : undefined,
        args:
          transport === "stdio"
            ? argsText
                .split(/\s+/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        url: transport === "http" ? url.trim() : undefined,
        envVaultKeys: envVaultKeysText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        enabled: true,
        defaultRiskTier,
        allowedEmployeeIds: "*",
        toolRiskOverrides: {},
      });
      setShowForm(false);
      setId("");
      setName("");
      setDescription("");
      setArgsText("");
      setUrl("");
      setEnvVaultKeysText("");
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "Failed to save MCP server");
    }
  };

  const handleTest = async (serverId: string) => {
    setTestingId(serverId);
    try {
      const res = await testMcp(serverId);
      setTestResults((prev) => ({ ...prev, [serverId]: res }));
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveSecurityPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    const domains = allowlistText
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    await updatePolicies({
      security: {
        enabled: browserEnabled,
        domainAllowlist: domains,
      },
    });
    setPolicySavedMsg(locale === "ar" ? "تم حفظ سياسة المتصفح بنجاح." : "Browser security policy saved.");
    setTimeout(() => setPolicySavedMsg(null), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {locale === "ar" ? "إدارة الأدوات والـ MCP Servers" : "MCP Servers & Controlled Tools"}
          </h1>
          <p className="text-[13px] text-studio-muted">
            {locale === "ar"
              ? "أضف أدوات خارجية، اختبر الاتصال، واضبط النطاقات المسموحة للمتصفح"
              : "Attach external MCP servers, test tool discovery, and enforce browser domain allowlists"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="h-8 px-3 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{locale === "ar" ? "إضافة MCP Server" : "Add MCP Server"}</span>
        </button>
      </div>

      {/* Starter Templates */}
      <section className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-2.5">
        <div className="text-[12px] font-semibold text-studio-muted">
          {locale === "ar" ? "قوالب جاهزة للتشغيل السريع:" : "Starter MCP Templates:"}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {mcpTemplates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl.id)}
              className="text-start p-2.5 rounded border border-studio-border bg-studio-blueprint hover:border-studio-accent transition-colors space-y-1"
            >
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-studio-ink">
                <Plug className="w-3.5 h-3.5 text-studio-accent" />
                <span>{tpl.name}</span>
              </div>
              <div className="text-[11px] text-studio-muted line-clamp-2">{tpl.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Add / Edit MCP Form */}
      {showForm && (
        <form
          onSubmit={handleSaveServer}
          className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-studio-muted mb-1">ID (slug)</label>
              <input
                required
                dir="ltr"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="github"
                className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              />
            </div>
            <div>
              <label className="block text-[11px] text-studio-muted mb-1">
                {locale === "ar" ? "الاسم" : "Display Name"}
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="GitHub MCP"
                className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
              />
            </div>
            <div>
              <label className="block text-[11px] text-studio-muted mb-1">Transport</label>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as McpTransport)}
                className="w-full h-8 px-2 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </div>

            {transport === "stdio" ? (
              <>
                <div>
                  <label className="block text-[11px] text-studio-muted mb-1">Command</label>
                  <input
                    required
                    dir="ltr"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                    className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] text-studio-muted mb-1">
                    Args (space-separated)
                  </label>
                  <input
                    dir="ltr"
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-github"
                    className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                  />
                </div>
              </>
            ) : (
              <div className="md:col-span-3">
                <label className="block text-[11px] text-studio-muted mb-1">HTTP MCP URL</label>
                <input
                  required
                  dir="ltr"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] text-studio-muted mb-1">
                Vault Env Keys (comma-separated)
              </label>
              <input
                dir="ltr"
                value={envVaultKeysText}
                onChange={(e) => setEnvVaultKeysText(e.target.value)}
                placeholder="GITHUB_TOKEN"
                className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              />
            </div>

            <div>
              <label className="block text-[11px] text-studio-muted mb-1">Default Risk Tier</label>
              <select
                value={defaultRiskTier}
                onChange={(e) => setDefaultRiskTier(e.target.value as RiskTier)}
                className="w-full h-8 px-2 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              >
                <option value="tier1_auto">tier1_auto</option>
                <option value="tier2_guarded">tier2_guarded</option>
                <option value="tier3_approval">tier3_approval</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-studio-muted mb-1">
                {locale === "ar" ? "الوصف" : "Description"}
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
              />
            </div>
          </div>

          {formErr && <p className="text-[12px] text-studio-crimson">{formErr}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-8 px-3 rounded border border-studio-border text-[12px]"
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
            <button
              type="submit"
              className="h-8 px-4 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium"
            >
              {locale === "ar" ? "حفظ الخادم" : "Save Server"}
            </button>
          </div>
        </form>
      )}

      {/* Registered MCP Servers */}
      <section className="space-y-2.5">
        {mcpServers.length === 0 ? (
          <div className="p-6 text-center bg-studio-surface border border-studio-border rounded-lg text-[13px] text-studio-muted">
            {locale === "ar"
              ? "لا توجد خوادم MCP خارجية مضافة بعد — اختر أحد القوالب بالأعلى أو أضف خادماً جديداً."
              : "No external MCP servers configured yet — pick a starter template above or add a custom server."}
          </div>
        ) : (
          mcpServers.map((srv) => {
            const testRes = testResults[srv.id];
            return (
              <div
                key={srv.id}
                className="p-4 bg-studio-surface border border-studio-border rounded-lg space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-studio-ink">{srv.name}</span>
                      <span className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px]">
                        {srv.id} · {srv.transport}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-studio-accent-soft text-studio-accent font-mono text-[11px]">
                        {srv.defaultRiskTier}
                      </span>
                    </div>
                    <div dir="ltr" className="mt-1 font-mono text-[11px] text-studio-muted">
                      {srv.transport === "stdio"
                        ? `${srv.command ?? ""} ${srv.args.join(" ")}`
                        : srv.url}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void patchMcp(srv.id, { enabled: !srv.enabled })}
                      className={`h-7 px-2.5 rounded text-[11px] font-mono font-semibold border ${
                        srv.enabled
                          ? "bg-studio-emerald-soft text-studio-emerald border-studio-emerald/30"
                          : "bg-studio-ground text-studio-muted border-studio-border"
                      }`}
                    >
                      {srv.enabled ? "ENABLED" : "DISABLED"}
                    </button>

                    <button
                      type="button"
                      disabled={testingId === srv.id}
                      onClick={() => void handleTest(srv.id)}
                      className="h-7 px-2.5 rounded border border-studio-border hover:bg-studio-ground text-[11px] font-medium flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      <span>{testingId === srv.id ? "..." : locale === "ar" ? "اختبار" : "Test"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteMcp(srv.id)}
                      className="p-1.5 text-studio-faint hover:text-studio-crimson"
                      title="Delete MCP server"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {testRes && (
                  <div
                    dir="ltr"
                    className={`p-2.5 rounded border font-mono text-[11px] ${
                      testRes.ok
                        ? "border-studio-emerald/30 bg-studio-emerald-soft/50 text-studio-ink"
                        : "border-studio-crimson/30 bg-studio-crimson-soft text-studio-crimson"
                    }`}
                  >
                    {testRes.ok ? (
                      <div>
                        ✓ Connected in {testRes.latencyMs}ms · Tools ({testRes.tools.length}):{" "}
                        {testRes.tools.map((tool) => tool.name).join(", ") || "none"}
                      </div>
                    ) : (
                      <div>✕ Failed ({testRes.latencyMs}ms): {testRes.error}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Controlled Browser SSRF & Domain Allowlist Policy */}
      <section className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-studio-accent" />
            <h2 className="text-[14px] font-semibold text-studio-ink">
              {locale === "ar"
                ? "سياسة أمان المتصفح المقيّد (SSRF & Domain Allowlist)"
                : "Controlled Browser Security Policy (SSRF & Allowlist)"}
            </h2>
          </div>
          <Shield className="w-4 h-4 text-studio-emerald" />
        </div>

        <form onSubmit={handleSaveSecurityPolicy} className="space-y-3">
          <label className="flex items-center gap-2 text-[12.5px] text-studio-ink cursor-pointer">
            <input
              type="checkbox"
              checked={browserEnabled}
              onChange={(e) => setBrowserEnabled(e.target.checked)}
            />
            <span>
              {locale === "ar"
                ? "تفعيل جلب صفحات الويب عبر النطاقات المسموحة فقط (HTTPS + عزل التلوث)"
                : "Enable controlled HTTPS fetch within domain allowlist (SSRF-guarded)"}
            </span>
          </label>

          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar"
                ? "النطاقات المسموحة (مفصولة بفاصلة)"
                : "Allowed Domains (comma-separated)"}
            </label>
            <input
              dir="ltr"
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              placeholder="github.com, api.github.com, docs.github.com"
              className="w-full h-9 px-3 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-studio-emerald">{policySavedMsg ?? ""}</span>
            <button
              type="submit"
              className="h-8 px-3.5 rounded bg-studio-ink text-studio-surface text-[12px] font-medium"
            >
              {locale === "ar" ? "حفظ السياسة" : "Save Allowlist"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
