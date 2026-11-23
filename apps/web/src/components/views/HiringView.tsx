import React, { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, UserPlus } from "lucide-react";
import type { HiringRoleTemplate, RiskTier, RuntimeProvider } from "@virtual-office/shared";
import { useOfficeStore } from "../../store/office-store.ts";

export function HiringView() {
  const {
    locale,
    employees,
    providers,
    hiringTemplates,
    hiringProposals,
    loadOrchestrationAndHiring,
    createHiringProposal,
    rollbackHiringProposal,
    setActiveView,
  } = useOfficeStore();

  const [employeeId, setEmployeeId] = useState("qa-engineer");
  const [name, setName] = useState("Tariq");
  const [nameAr, setNameAr] = useState("طارق");
  const [role, setRole] = useState("QA & Verification Engineer");
  const [roleAr, setRoleAr] = useState("مهندس جودة واختبار");
  const [department, setDepartment] = useState("engineering");
  const [avatar, setAvatar] = useState("QA");
  const [provider, setProvider] = useState<RuntimeProvider>("agy");
  const [model, setModel] = useState("gemini-3.8-flash-medium");
  const [maxRiskTier, setMaxRiskTier] = useState<RiskTier>("tier1_auto");
  const [justification, setJustification] = useState(
    "Dedicated QA verification & automated regression gatekeeping.",
  );
  const [systemPrompt, setSystemPrompt] = useState(
    "You are Tariq, the QA & Verification Engineer. Verify tests, report honest command exit codes, and protect release quality.",
  );
  const [coreSkillContent, setCoreSkillContent] = useState(
    "- Verify TypeScript builds.\n- Write edge-case regression checks.\n- Report exact file paths and failures.",
  );
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{
    ok: boolean;
    text: string;
    showApprovalsLink?: boolean;
  } | null>(null);
  const [busyRollbackId, setBusyRollbackId] = useState<string | null>(null);

  useEffect(() => {
    void loadOrchestrationAndHiring();
  }, [loadOrchestrationAndHiring]);

  const applyTemplate = (tpl: HiringRoleTemplate) => {
    const d = tpl.defaults;
    setEmployeeId(d.employeeId ?? tpl.id);
    setName(d.name);
    setNameAr(d.nameAr);
    setRole(d.role);
    setRoleAr(d.roleAr);
    setDepartment(d.department ?? "engineering");
    setAvatar(d.avatar);
    setProvider(d.runtime?.provider ?? "agy");
    setModel(d.runtime?.model ?? "gemini-3.8-flash-medium");
    setMaxRiskTier(d.permissions?.maxRiskTier ?? "tier1_auto");
    setJustification(d.justification);
    setSystemPrompt(d.systemPrompt);
    setCoreSkillContent(d.coreSkillContent);
    setBanner(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setSubmitting(true);
    try {
      const res = await createHiringProposal({
        proposedByEmployeeId: "hr-talent",
        employeeId: employeeId.trim() || undefined,
        name: name.trim(),
        nameAr: nameAr.trim(),
        role: role.trim(),
        roleAr: roleAr.trim(),
        department,
        avatar: avatar.trim() || "AI",
        justification: justification.trim(),
        systemPrompt: systemPrompt.trim(),
        coreSkillTitle: `${role.trim()} Core SOP`,
        coreSkillContent: coreSkillContent.trim(),
        runtime: { provider, model, effort: "medium" },
        permissions: {
          maxRiskTier,
          tier2AutoInWorktree: maxRiskTier === "tier2_guarded",
        },
        autoSubmitForApproval: true,
      });
      setBanner({
        ok: true,
        showApprovalsLink: true,
        text:
          locale === "ar"
            ? `تم تقديم طلب توظيف ${res.proposal.spec.nameAr} (مكتب ${res.proposal.proposedDesk.id}) إلى طابور الموافقات.`
            : `Submitted hiring proposal for ${res.proposal.spec.name} (desk ${res.proposal.proposedDesk.id}) to Approvals Queue.`,
      });
    } catch (err) {
      setBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to create hiring proposal",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRollback = async (id: string) => {
    setBusyRollbackId(id);
    setBanner(null);
    try {
      await rollbackHiringProposal(id, "Founder rolled back hire from Hiring view");
      setBanner({
        ok: true,
        text:
          locale === "ar"
            ? "تم التراجع عن التوظيف وإزالة مجلد الموظف ومكتبه من الخريطة بنجاح."
            : "Hire rolled back: employee directory and floorplan desk removed cleanly.",
      });
    } catch (err) {
      setBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Rollback failed",
      });
    } finally {
      setBusyRollbackId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {locale === "ar"
              ? "دورة التوظيف الكاملة وتوزيع المكاتب (HR Provisioning)"
              : "HR Hiring Workflow & Auto Floorplan Provisioning"}
          </h1>
          <p className="text-[13px] text-studio-muted">
            {locale === "ar"
              ? "إنشاء مقترح موظف جديد بقيادة ليلى -> موافقة Founder Tier 3 -> إنشاء المجلد وإسناد مكتب آلي على الخريطة"
              : "Layla drafts role proposals -> Tier 3 Founder Approval -> atomic folder provisioning + non-overlapping desk assignment"}
          </p>
        </div>

        <span dir="ltr" className="px-2.5 py-1 rounded border border-studio-border bg-studio-surface font-mono text-[12px]">
          Active Roster: {employees.length}
        </span>
      </div>

      {/* Role Templates */}
      {hiringTemplates.length > 0 && (
        <section className="space-y-2">
          <div className="text-[12px] font-semibold text-studio-muted">
            {locale === "ar" ? "قوالب أدوار جاهزة (اضغط للتعبئة):" : "Curated Role Templates (Click to Prefill):"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {hiringTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="text-start p-3 rounded-lg border border-studio-border bg-studio-surface hover:border-studio-accent transition-colors space-y-1"
              >
                <div className="text-[13px] font-semibold text-studio-ink">
                  {locale === "ar" ? tpl.labelAr : tpl.label}
                </div>
                <p className="text-[11px] text-studio-muted line-clamp-2">
                  {locale === "ar" ? tpl.descriptionAr : tpl.description}
                </p>
                <div dir="ltr" className="text-[10px] font-mono text-studio-accent">
                  {tpl.defaults.department} · {tpl.defaults.permissions?.maxRiskTier ?? "tier1_auto"}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Proposal Composer */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-[14px] font-semibold text-studio-ink">
          <UserPlus className="w-4 h-4 text-studio-accent" />
          <span>
            {locale === "ar" ? "تقديم مقترح توظيف للموافقة" : "Propose New AI Employee"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-[12px]">
          <div>
            <label className="block text-studio-muted mb-1">ID (slug)</label>
            <input
              required
              dir="ltr"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
            />
          </div>
          <div>
            <label className="block text-studio-muted mb-1">
              {locale === "ar" ? "الاسم (عربي)" : "Name (AR)"}
            </label>
            <input
              required
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
          <div>
            <label className="block text-studio-muted mb-1">Name (EN)</label>
            <input
              required
              dir="ltr"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
          <div>
            <label className="block text-studio-muted mb-1">Avatar Tag</label>
            <input
              required
              dir="ltr"
              maxLength={4}
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-[12px]">
          <div>
            <label className="block text-studio-muted mb-1">
              {locale === "ar" ? "المسمى الوظيفي (عربي)" : "Role (AR)"}
            </label>
            <input
              required
              value={roleAr}
              onChange={(e) => setRoleAr(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
          <div>
            <label className="block text-studio-muted mb-1">Role Title (EN)</label>
            <input
              required
              dir="ltr"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
          <div>
            <label className="block text-studio-muted mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
            >
              <option value="engineering">engineering</option>
              <option value="product">product</option>
              <option value="growth">growth</option>
              <option value="operations">operations</option>
              <option value="people">people</option>
              <option value="executive">executive</option>
            </select>
          </div>
          <div>
            <label className="block text-studio-muted mb-1">Max Risk Tier</label>
            <select
              value={maxRiskTier}
              onChange={(e) => setMaxRiskTier(e.target.value as RiskTier)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
            >
              <option value="tier1_auto">tier1_auto (Read/Draft)</option>
              <option value="tier2_guarded">tier2_guarded (Worktree Write)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[12px]">
          <div>
            <label className="block text-studio-muted mb-1">Default Runtime & Model</label>
            <div className="flex gap-2">
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as RuntimeProvider;
                  setProvider(p);
                  const h = providers.find((x) => x.provider === p);
                  if (h?.models[0]) setModel(h.models[0]);
                }}
                className="h-9 px-2 rounded border border-studio-border bg-studio-blueprint font-mono"
              >
                {["agy", "codex", "claude", "gemini_api", "openai_api", "anthropic_api", "openrouter_api", "ollama"].map(
                  (p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ),
                )}
              </select>
              <input
                dir="ltr"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-studio-muted mb-1">
              {locale === "ar" ? "مبرر التعيين" : "Justification"}
            </label>
            <input
              required
              dir="auto"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="w-full h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[12px]">
          <textarea
            required
            dir="auto"
            rows={2}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="System prompt (system.md)..."
            className="p-2.5 rounded border border-studio-border bg-studio-blueprint resize-none"
          />
          <textarea
            required
            dir="auto"
            rows={2}
            value={coreSkillContent}
            onChange={(e) => setCoreSkillContent(e.target.value)}
            placeholder="Core operating SOP (skills/core.md)..."
            className="p-2.5 rounded border border-studio-border bg-studio-blueprint resize-none"
          />
        </div>

        {banner && (
          <div
            className={`px-3 py-2 rounded border text-[12px] flex items-center justify-between gap-2 ${
              banner.ok
                ? "border-studio-emerald/35 bg-studio-emerald-soft text-studio-emerald"
                : "border-studio-crimson/35 bg-studio-crimson-soft text-studio-crimson"
            }`}
          >
            <span>{banner.text}</span>
            {banner.ok && banner.showApprovalsLink && (
              <button
                type="button"
                onClick={() => setActiveView("approvals")}
                className="px-2.5 py-1 rounded bg-studio-ink text-studio-surface text-[11px] font-semibold shrink-0"
              >
                {locale === "ar" ? "فتح الموافقات →" : "Open Approvals →"}
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="h-9 px-4 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>
              {locale === "ar"
                ? "إرسال طلب التوظيف (Tier 3 Approval)"
                : "Submit Hiring Proposal (Tier 3 Approval)"}
            </span>
          </button>
        </div>
      </form>

      {/* Proposals History */}
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-studio-ink">
          {locale === "ar" ? "سجل طلبات التوظيف" : "Hiring Proposals"}
        </h2>
        {hiringProposals.length === 0 ? (
          <div className="p-6 text-center bg-studio-surface border border-studio-border rounded-lg text-[13px] text-studio-muted">
            <CheckCircle2 className="w-5 h-5 mx-auto mb-1.5 text-studio-emerald" />
            <p>
              {locale === "ar"
                ? "لا توجد طلبات توظيف مسجلة بعد — استخدم القوالب أعلاه لاقتراح موظف جديد."
                : "No hiring proposals yet — pick a role template above to propose a new team member."}
            </p>
          </div>
        ) : (
          hiringProposals.map((prop) => (
            <article
              key={prop.id}
              className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-studio-ink">
                      {locale === "ar" ? prop.spec.nameAr : prop.spec.name} —{" "}
                      {locale === "ar" ? prop.spec.roleAr : prop.spec.role}
                    </span>
                    <span dir="ltr" className="px-2 py-0.5 rounded bg-studio-ground font-mono text-[11px]">
                      {prop.employeeId}
                    </span>
                    <span
                      dir="ltr"
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                        prop.status === "PROVISIONED"
                          ? "bg-studio-emerald-soft text-studio-emerald"
                          : prop.status === "PENDING_APPROVAL"
                            ? "bg-studio-amber-soft text-studio-amber"
                            : "bg-studio-ground text-studio-muted"
                      }`}
                    >
                      {prop.status}
                    </span>
                  </div>
                  <div dir="auto" className="mt-1 text-[12px] text-studio-muted">
                    {prop.spec.justification}
                  </div>
                </div>

                <div dir="ltr" className="font-mono text-[11px] text-studio-muted">
                  desk:{prop.proposedDesk.id} @ ({prop.proposedDesk.x}, {prop.proposedDesk.y})
                </div>
              </div>

              <pre
                dir="ltr"
                className="p-2.5 rounded border border-studio-border bg-studio-blueprint text-[11px] font-mono text-left overflow-x-auto max-h-40"
              >
                {prop.diffPreview}
              </pre>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {prop.status === "PENDING_APPROVAL" && (
                  <button
                    type="button"
                    onClick={() => setActiveView("approvals")}
                    className="h-8 px-3 rounded bg-studio-amber text-white text-[12px] font-semibold"
                  >
                    {locale === "ar" ? "مراجعة في الموافقات →" : "Review in Approvals →"}
                  </button>
                )}
                {prop.status === "PROVISIONED" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveView("office")}
                      className="h-8 px-3 rounded border border-studio-accent text-studio-accent text-[12px] font-medium"
                    >
                      {locale === "ar" ? "معاينة على خريطة المكتب" : "View on Office Map"}
                    </button>
                    <button
                      type="button"
                      disabled={busyRollbackId === prop.id}
                      onClick={() => void handleRollback(prop.id)}
                      className="h-8 px-3 rounded border border-studio-crimson/40 text-studio-crimson hover:bg-studio-crimson-soft text-[12px] font-semibold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>
                        {locale === "ar" ? "تراجع وإلغاء التعيين (Rollback)" : "Rollback Hire"}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
