import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import type { ApprovalStatus } from "@virtual-office/shared";
import { t } from "../../i18n/translations.ts";
import { useOfficeStore } from "../../store/office-store.ts";

export function ApprovalsView() {
  const { locale, approvals, employees, decideApproval } = useOfficeStore();
  const [filter, setFilter] = useState<"ALL" | ApprovalStatus>("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const empMap = new Map(employees.map((e) => [e.profile.id, e]));

  const filtered =
    filter === "ALL" ? approvals : approvals.filter((a) => a.status === filter);

  const selected = filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (filtered.length > 0 && (!selectedId || !filtered.some((a) => a.id === selectedId))) {
      setSelectedId(filtered[0]!.id);
    } else if (filtered.length === 0 && selectedId !== null) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const handleDecision = async (id: string, decision: "APPROVED" | "REJECTED") => {
    setBusyId(id);
    try {
      const res = await decideApproval(id, {
        decision,
        note: notes[id]?.trim() || undefined,
      });
      setFeedback((prev) => ({
        ...prev,
        [id]: {
          ok: res.ok,
          text: res.reason ? `${res.status}: ${res.reason}` : `${res.status}`,
        },
      }));
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          text: err instanceof Error ? err.message : "Request failed",
        },
      }));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (filtered.length === 0 || !selected) return;

      const idx = filtered.findIndex((a) => a.id === selected.id);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = filtered[(idx + 1) % filtered.length];
        if (next) setSelectedId(next.id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = filtered[(idx - 1 + filtered.length) % filtered.length];
        if (prev) setSelectedId(prev.id);
      } else if (e.key.toLowerCase() === "r" && selected.status === "PENDING") {
        e.preventDefault();
        noteInputRef.current?.focus();
      } else if (
        e.key.toLowerCase() === "a" &&
        selected.status === "PENDING" &&
        !selected.taintedByExternalInput &&
        busyId !== selected.id
      ) {
        e.preventDefault();
        void handleDecision(selected.id, "APPROVED");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, selected, busyId]);

  const filters: Array<"PENDING" | "EXECUTED" | "REJECTED" | "EXPIRED" | "ALL"> = [
    "PENDING",
    "EXECUTED",
    "REJECTED",
    "EXPIRED",
    "ALL",
  ];

  const selectedEmp = selected ? empMap.get(selected.employeeId) : undefined;
  const selectedFb = selected ? feedback[selected.id] : undefined;
  const selectedIsPending = selected?.status === "PENDING";

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {t(locale, "approvalsTitle")}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">{t(locale, "approvalsQuestion")}</p>
        </div>

        <div className="inline-flex p-0.5 rounded-md border border-studio-border bg-studio-surface">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[12px] font-mono rounded transition-colors ${
                filter === f
                  ? "bg-studio-ink text-studio-surface font-semibold"
                  : "text-studio-muted hover:text-studio-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-10 text-center bg-studio-surface border border-studio-border rounded-lg text-[13px] text-studio-muted">
          <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-studio-emerald" />
          <p>{t(locale, "noApprovals")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-4 items-start">
          {/* Inbox List Column */}
          <div className="bg-studio-surface border border-studio-border rounded-lg divide-y divide-studio-border max-h-[72vh] overflow-y-auto">
            {filtered.map((item) => {
              const emp = empMap.get(item.employeeId);
              const isSelected = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-start p-3 space-y-1 transition-colors ${
                    isSelected
                      ? "bg-studio-subtle border-s-2 border-s-studio-accent"
                      : "hover:bg-studio-ground/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-studio-ink truncate">
                      {item.title}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold shrink-0 ${
                        item.status === "PENDING"
                          ? "bg-studio-amber-soft text-studio-amber"
                          : item.status === "EXECUTED"
                            ? "bg-studio-emerald-soft text-studio-emerald"
                            : "bg-studio-crimson-soft text-studio-crimson"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-studio-muted">
                    <span className="truncate">
                      {emp
                        ? locale === "ar"
                          ? emp.profile.nameAr
                          : emp.profile.name
                        : item.employeeId}{" "}
                      · <span dir="ltr" className="font-mono">{item.actionType}</span>
                    </span>
                    {item.taintedByExternalInput && (
                      <AlertTriangle className="w-3.5 h-3.5 text-studio-crimson shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail Diff Inspector & Action Column */}
          {selected && (
            <article className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3.5 lg:sticky lg:top-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-studio-ink">
                      {selected.title}
                    </span>
                    <span
                      dir="ltr"
                      className="px-2 py-0.5 rounded bg-studio-ground border border-studio-border font-mono text-[11px]"
                    >
                      {selected.actionType}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                        selected.status === "PENDING"
                          ? "bg-studio-amber-soft text-studio-amber"
                          : selected.status === "EXECUTED"
                            ? "bg-studio-emerald-soft text-studio-emerald"
                            : "bg-studio-crimson-soft text-studio-crimson"
                      }`}
                    >
                      {selected.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-studio-muted">
                    {selectedEmp
                      ? locale === "ar"
                        ? `${selectedEmp.profile.nameAr} (${selectedEmp.profile.roleAr})`
                        : `${selectedEmp.profile.name} (${selectedEmp.profile.role})`
                      : selected.employeeId}
                    {" · "}
                    <span dir="ltr" className="font-mono">
                      {new Date(selected.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div dir="ltr" className="text-[11px] font-mono text-studio-muted">
                  Expires: {new Date(selected.expiresAt).toLocaleString()}
                </div>
              </div>

              {selected.taintedByExternalInput && (
                <div className="px-3 py-2 rounded border border-studio-crimson/35 bg-studio-crimson-soft text-studio-crimson text-[12px] flex items-center gap-2 font-medium">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t(locale, "taintedWarning")}</span>
                </div>
              )}

              <p dir="auto" className="text-[13px] text-studio-ink leading-relaxed">
                {selected.summary}
              </p>

              <div dir="ltr" className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                  <div className="text-[11px] font-mono text-studio-muted mb-1">Payload</div>
                  <pre className="text-[11px] font-mono text-studio-ink whitespace-pre-wrap break-all max-h-52 overflow-auto">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>

                {selected.diffPreview ? (
                  <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                    <div className="text-[11px] font-mono text-studio-muted mb-1">
                      Diff Preview
                    </div>
                    <pre className="text-[11px] font-mono text-studio-ink whitespace-pre-wrap break-all max-h-52 overflow-auto">
                      {selected.diffPreview}
                    </pre>
                  </div>
                ) : (
                  <div className="p-2.5 rounded border border-studio-border bg-studio-blueprint">
                    <div className="text-[11px] font-mono text-studio-muted mb-1">
                      Preconditions & Integrity Hash
                    </div>
                    <div className="text-[11px] font-mono text-studio-muted break-all">
                      payloadHash: {selected.payloadHash.slice(0, 20)}...
                    </div>
                    {selected.preconditionSnapshot && (
                      <pre className="mt-1 text-[11px] font-mono text-studio-ink whitespace-pre-wrap">
                        {JSON.stringify(selected.preconditionSnapshot, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {selectedFb && (
                <div
                  className={`px-3 py-1.5 rounded text-[12px] font-mono ${
                    selectedFb.ok
                      ? "bg-studio-emerald-soft text-studio-emerald"
                      : "bg-studio-crimson-soft text-studio-crimson"
                  }`}
                >
                  {selectedFb.text}
                </div>
              )}

              {selectedIsPending && (
                <div className="pt-2.5 border-t border-studio-border space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={noteInputRef}
                      value={notes[selected.id] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [selected.id]: e.target.value }))
                      }
                      placeholder={t(locale, "decisionNotePlaceholder")}
                      className="flex-1 min-w-[200px] h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent"
                    />
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void handleDecision(selected.id, "REJECTED")}
                      className="h-8 px-3 rounded border border-studio-crimson/35 text-studio-crimson hover:bg-studio-crimson-soft text-[12px] font-medium flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t(locale, "rejectBtn")}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void handleDecision(selected.id, "APPROVED")}
                      className="h-8 px-3.5 rounded-md bg-studio-emerald text-studio-ground hover:opacity-90 text-[12px] font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t(locale, "approveBtn")}</span>
                    </button>
                  </div>
                  <div className="text-[11px] text-studio-faint font-mono" dir="ltr">
                    Keys: ↑/↓ Select · R Note ·{" "}
                    {selected.taintedByExternalInput ? "A Disabled (Tainted requires click)" : "A Approve"}
                  </div>
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
