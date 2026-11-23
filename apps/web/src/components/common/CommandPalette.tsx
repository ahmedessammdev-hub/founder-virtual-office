import React, { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, FolderKanban, Languages, Moon, Plus, Search, ShieldCheck, Sun, Users, Zap } from "lucide-react";
import { t } from "../../i18n/translations.ts";
import { useOfficeStore, type AppView } from "../../store/office-store.ts";

interface PaletteItem {
  id: string;
  group: "employee" | "view" | "project" | "action";
  title: string;
  subtitle?: string;
  keywords: string;
  onSelect: () => void;
}

function normalizeQueryText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

export function CommandPalette() {
  const {
    locale,
    setLocale,
    uiTheme,
    toggleUiTheme,
    commandPaletteOpen,
    setCommandPaletteOpen,
    setRegisterModalOpen,
    employees,
    projects,
    setActiveView,
    setActiveProjectId,
    selectEmployee,
    setRunMode,
    approvals,
  } = useOfficeStore();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      } else if (e.key === "Escape" && commandPaletteOpen) {
        e.preventDefault();
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [commandPaletteOpen]);

  const pendingApprovalsCount = approvals.filter((a) => a.status === "PENDING").length;

  const allItems = useMemo<PaletteItem[]>(() => {
    const viewDefs: Array<{ id: AppView; ar: string; en: string }> = [
      { id: "office", ar: "المكتب الافتراضي", en: "Virtual Office" },
      { id: "orchestration", ar: "التنسيق والاجتماعات", en: "DAG & Meetings" },
      { id: "projects", ar: "المشاريع والمهام", en: "Projects & Tasks" },
      { id: "automation", ar: "الأتمتة و Telegram", en: "Cron & Telegram" },
      { id: "approvals", ar: "الموافقات", en: "Approvals" },
      { id: "memory", ar: "الذاكرة الموثّقة", en: "Verified Memory" },
      { id: "hiring", ar: "التوظيف والفريق", en: "Hiring & Team" },
      { id: "mcps", ar: "الأدوات والـ MCPs", en: "MCPs & Tools" },
      { id: "providers", ar: "المزودات والتكلفة", en: "Providers & Cost" },
      { id: "audit", ar: "التحليلات والنسخ", en: "Analytics & Backup" },
    ];

    const empItems: PaletteItem[] = employees.map((emp) => ({
      id: `emp:${emp.profile.id}`,
      group: "employee",
      title: locale === "ar" ? `${emp.profile.nameAr} — ${emp.profile.roleAr}` : `${emp.profile.name} — ${emp.profile.role}`,
      subtitle: `@${emp.profile.id} · ${emp.profile.runtime.provider.toUpperCase()}`,
      keywords: normalizeQueryText(
        `${emp.profile.id} ${emp.profile.name} ${emp.profile.nameAr} ${emp.profile.role} ${emp.profile.roleAr} ${emp.profile.department}`,
      ),
      onSelect: () => {
        setActiveView("office");
        void selectEmployee(emp.profile.id);
      },
    }));

    const viewItems: PaletteItem[] = viewDefs.map((v) => ({
      id: `view:${v.id}`,
      group: "view",
      title: locale === "ar" ? v.ar : v.en,
      subtitle:
        v.id === "approvals" && pendingApprovalsCount > 0
          ? `${pendingApprovalsCount} pending`
          : `/${v.id}`,
      keywords: normalizeQueryText(`${v.id} ${v.ar} ${v.en}`),
      onSelect: () => setActiveView(v.id),
    }));

    const projectItems: PaletteItem[] = projects.map((p) => ({
      id: `proj:${p.id}`,
      group: "project",
      title: p.name,
      subtitle: p.rootPath,
      keywords: normalizeQueryText(`${p.id} ${p.name} ${p.rootPath}`),
      onSelect: () => {
        setActiveProjectId(p.id);
        setActiveView("projects");
      },
    }));

    const actions: PaletteItem[] = [
      {
        id: "act:theme",
        group: "action",
        title:
          uiTheme === "dark"
            ? locale === "ar"
              ? "التبديل إلى الوضع المشرق (Sunlit)"
              : "Switch to Sunlit Light Theme"
            : locale === "ar"
              ? "التبديل إلى الوضع الداكن (Dark Command)"
              : "Switch to Dark Command Theme",
        subtitle: "Theme",
        keywords: normalizeQueryText("theme dark light وضع داكن مشرق ثيم"),
        onSelect: () => toggleUiTheme(),
      },
      {
        id: "act:lang",
        group: "action",
        title: locale === "ar" ? "تغيير اللغة إلى الإنجليزية (EN)" : "Switch Language to Arabic (عربي)",
        subtitle: "Locale RTL/LTR",
        keywords: normalizeQueryText("language locale arabic english عربي انجليزي لغه"),
        onSelect: () => setLocale(locale === "ar" ? "en" : "ar"),
      },
      {
        id: "act:mock",
        group: "action",
        title: locale === "ar" ? "تفعيل وضع اختبار Mock" : "Switch Run Mode to Mock",
        subtitle: "RunMode = mock",
        keywords: normalizeQueryText("mock test mode اختبار"),
        onSelect: () => setRunMode("mock"),
      },
      {
        id: "act:live",
        group: "action",
        title: locale === "ar" ? "تفعيل وضع التشغيل الفعلي Live" : "Switch Run Mode to Live",
        subtitle: "RunMode = live",
        keywords: normalizeQueryText("live real mode فعلي"),
        onSelect: () => setRunMode("live"),
      },
      {
        id: "act:register-proj",
        group: "action",
        title: t(locale, "registerProjectBtn"),
        subtitle: "Workspace",
        keywords: normalizeQueryText("register project workspace مشروع تسجيل"),
        onSelect: () => setRegisterModalOpen(true),
      },
    ];

    return [...empItems, ...viewItems, ...projectItems, ...actions];
  }, [
    employees,
    projects,
    locale,
    uiTheme,
    pendingApprovalsCount,
    setActiveView,
    selectEmployee,
    setActiveProjectId,
    toggleUiTheme,
    setLocale,
    setRunMode,
    setRegisterModalOpen,
  ]);

  const filtered = useMemo(() => {
    const q = normalizeQueryText(query);
    if (!q) return allItems.slice(0, 14);
    return allItems.filter((item) => item.keywords.includes(q)).slice(0, 16);
  }, [allItems, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!commandPaletteOpen) return null;

  const choose = (item: PaletteItem) => {
    item.onSelect();
    setCommandPaletteOpen(false);
  };

  const renderGroupIcon = (group: PaletteItem["group"], id: string) => {
    if (group === "employee") return <Users className="w-4 h-4 text-studio-accent shrink-0" />;
    if (group === "project") return <FolderKanban className="w-4 h-4 text-studio-emerald shrink-0" />;
    if (id === "act:theme")
      return uiTheme === "dark" ? (
        <Sun className="w-4 h-4 text-studio-amber shrink-0" />
      ) : (
        <Moon className="w-4 h-4 text-studio-accent shrink-0" />
      );
    if (id === "act:lang") return <Languages className="w-4 h-4 text-studio-muted shrink-0" />;
    if (id === "act:register-proj") return <Plus className="w-4 h-4 text-studio-emerald shrink-0" />;
    if (group === "action") return <Zap className="w-4 h-4 text-studio-amber shrink-0" />;
    if (id === "view:approvals") return <ShieldCheck className="w-4 h-4 text-studio-amber shrink-0" />;
    return <Cpu className="w-4 h-4 text-studio-muted shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-start justify-center pt-[12vh] p-4"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command Palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-studio-border-strong bg-studio-surface shadow-float overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-studio-border">
          <Search className="w-4 h-4 text-studio-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((idx) => (filtered.length > 0 ? (idx + 1) % filtered.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((idx) =>
                  filtered.length > 0 ? (idx - 1 + filtered.length) % filtered.length : 0,
                );
              } else if (e.key === "Enter" && filtered[selectedIdx]) {
                e.preventDefault();
                choose(filtered[selectedIdx]!);
              }
            }}
            dir="auto"
            placeholder={
              locale === "ar"
                ? "ابحث عن موظف، شاشة، مشروع، أو أمر فوري..."
                : "Jump to employee, screen, project, or action..."
            }
            className="flex-1 bg-transparent text-[13.5px] text-studio-ink placeholder:text-studio-faint focus:outline-none"
          />
          <kbd
            dir="ltr"
            className="px-1.5 py-0.5 rounded border border-studio-border bg-studio-ground font-mono text-[10.5px] text-studio-muted"
          >
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-studio-muted">
              {locale === "ar" ? "لا توجد نتائج مطابقة." : "No matching commands."}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => choose(item)}
                  className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-start transition-colors ${
                    active
                      ? "bg-studio-subtle text-studio-ink"
                      : "text-studio-ink hover:bg-studio-subtle/50"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    {renderGroupIcon(item.group, item.id)}
                    <span className="text-[13px] font-medium truncate" dir="auto">
                      {item.title}
                    </span>
                  </span>
                  {item.subtitle && (
                    <span
                      dir="ltr"
                      className="text-[11px] font-mono text-studio-muted shrink-0 max-w-[180px] truncate"
                    >
                      {item.subtitle}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
