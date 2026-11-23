import React, { useState } from "react";
import {
  Activity,
  Bell,
  Building2,
  Clock,
  Cpu,
  FolderKanban,
  GitBranch,
  Languages,
  Menu,
  Moon,
  Plug,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { t } from "../i18n/translations.ts";
import { useOfficeStore, type AppView } from "../store/office-store.ts";
import { CommandPalette } from "./common/CommandPalette.tsx";
import { NotificationCenter } from "./common/NotificationCenter.tsx";

interface AppShellProps {
  children: React.ReactNode;
}

interface NavItemDef {
  id: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export function AppShell({ children }: AppShellProps) {
  const {
    locale,
    setLocale,
    uiTheme,
    toggleUiTheme,
    activeView,
    setActiveView,
    setCommandPaletteOpen,
    registerModalOpen,
    setRegisterModalOpen,
    notifications,
    markAllNotificationsRead,
    clearNotifications,
    company,
    projects,
    activeProjectId,
    setActiveProjectId,
    runMode,
    setRunMode,
    approvals,
    wsStatus,
    registerProject,
    selectEmployee,
  } = useOfficeStore();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [projName, setProjName] = useState("");
  const [projRoot, setProjRoot] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projError, setProjError] = useState<string | null>(null);
  const [submittingProj, setSubmittingProj] = useState(false);

  const pendingApprovals = approvals.filter((a) => a.status === "PENDING").length;
  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const navGroups: Array<{ title: string; items: NavItemDef[] }> = [
    {
      title: t(locale, "navGroupOps"),
      items: [
        { id: "office", label: t(locale, "navOffice"), icon: Building2 },
        { id: "orchestration", label: t(locale, "navOrchestration"), icon: GitBranch },
        { id: "projects", label: t(locale, "navProjects"), icon: FolderKanban },
        { id: "automation", label: t(locale, "navAutomation"), icon: Clock },
      ],
    },
    {
      title: t(locale, "navGroupGov"),
      items: [
        {
          id: "approvals",
          label: t(locale, "navApprovals"),
          icon: ShieldCheck,
          badge: pendingApprovals > 0 ? pendingApprovals : undefined,
        },
        { id: "memory", label: t(locale, "navMemory"), icon: Sparkles },
        { id: "hiring", label: t(locale, "navHiring"), icon: UserPlus },
      ],
    },
    {
      title: t(locale, "navGroupSys"),
      items: [
        { id: "mcps", label: t(locale, "navMcps"), icon: Plug },
        { id: "providers", label: t(locale, "navProviders"), icon: Cpu },
        { id: "audit", label: t(locale, "navAudit"), icon: ScrollText },
      ],
    },
  ];

  const handleQuickRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjError(null);
    setSubmittingProj(true);
    try {
      await registerProject({
        name: projName.trim(),
        rootPath: projRoot.trim(),
        description: projDesc.trim(),
      });
      setRegisterModalOpen(false);
      setProjName("");
      setProjRoot("");
      setProjDesc("");
    } catch (err) {
      setProjError(err instanceof Error ? err.message : "Failed to register project");
    } finally {
      setSubmittingProj(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-studio-ground text-studio-ink">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/45 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Architectural Obsidian Navigation Rail */}
      <aside
        className={`${
          mobileNavOpen ? "fixed inset-y-0 start-0 z-40 flex" : "hidden"
        } md:sticky md:top-0 md:h-screen md:flex w-[216px] shrink-0 border-e border-studio-border bg-studio-ground flex-col justify-between`}
      >
        <div className="min-h-0 flex-1 flex flex-col">
          {/* Brand Lockup */}
          <div className="h-12 px-3.5 shrink-0 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/icon.svg"
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 shrink-0 rounded-md"
              />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-tight leading-tight truncate text-studio-ink">
                  {locale === "ar"
                    ? (company?.nameAr ?? t(locale, "appTitle"))
                    : (company?.name ?? t(locale, "appTitle"))}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="md:hidden p-1 text-studio-muted hover:text-studio-ink"
              aria-label="Close Menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 3-Band Grouped Navigation */}
          <nav className="px-2.5 py-2 space-y-4 overflow-y-auto flex-1" aria-label="Primary">
            {navGroups.map((group) => (
              <div key={group.title} className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[11px] font-medium text-studio-faint">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveView(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                        active
                          ? "bg-studio-subtle text-studio-ink font-medium"
                          : "text-studio-muted hover:text-studio-ink hover:bg-studio-surface/60"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            active ? "text-studio-accent" : "text-studio-faint"
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className="px-1.5 py-0.5 text-[11px] font-mono font-medium rounded-md bg-studio-amber-soft text-studio-amber tabular-nums">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Live WS Status Footer */}
        <div className="px-3.5 py-2.5 border-t border-studio-border text-[11.5px] flex items-center justify-between shrink-0">
          <span className="flex items-center gap-2 text-studio-muted">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsStatus === "connected"
                  ? "bg-studio-emerald"
                  : wsStatus === "connecting"
                    ? "bg-studio-amber"
                    : "bg-studio-crimson"
              }`}
            />
            <span>
              {wsStatus === "connected"
                ? t(locale, "wsConnected")
                : wsStatus === "connecting"
                  ? t(locale, "wsConnecting")
                  : t(locale, "wsDisconnected")}
            </span>
          </span>
          <Activity className="w-3.5 h-3.5 text-studio-faint" />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Minimalist 48px Top Header */}
        <header className="h-12 shrink-0 px-4 border-b border-studio-border bg-studio-ground flex items-center justify-between gap-3 relative z-20">
          {/* Start Controls: Mobile Nav + Workspace Scope */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden h-8 w-8 rounded-lg border border-studio-border flex items-center justify-center text-studio-ink hover:bg-studio-surface"
              aria-label="Open Navigation"
            >
              <Menu className="w-4 h-4" />
            </button>

            <label htmlFor="project-switcher" className="sr-only">
              {t(locale, "navProjects")}
            </label>
            <select
              id="project-switcher"
              value={activeProjectId ?? ""}
              onChange={(e) => setActiveProjectId(e.target.value || null)}
              className="h-8 px-2.5 text-[12.5px] rounded-lg border border-studio-border bg-studio-surface text-studio-ink max-w-[205px] shrink-0 whitespace-nowrap focus:outline-none focus:border-studio-border-strong"
            >
              <option value="">{t(locale, "companyWorkspace")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.isGitRepo ? "Git" : "Folder"})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setRegisterModalOpen(true)}
              className="h-8 px-2.5 text-[12px] font-medium rounded-lg text-studio-muted hover:text-studio-ink hover:bg-studio-surface inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t(locale, "registerProjectBtn").replace(/^\+\s*/, "")}</span>
            </button>
          </div>

          {/* Centered Command Trigger */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="h-8 px-3 text-[12px] rounded-lg border border-studio-border bg-studio-surface hover:border-studio-border-strong text-studio-muted hover:text-studio-ink hidden sm:inline-flex items-center justify-between gap-4 w-56 lg:w-72 transition-colors"
            title={t(locale, "commandSearchHint")}
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-studio-faint shrink-0" />
              <span className="truncate">
                {locale === "ar" ? "بحث أو أمر…" : "Jump to command…"}
              </span>
            </span>
            <kbd
              dir="ltr"
              className="px-1.5 py-0.5 rounded bg-studio-subtle font-mono text-[10px] text-studio-faint"
            >
              Ctrl+K
            </kbd>
          </button>

          {/* End Controls: Execution Mode + Notifications + Theme + Language */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="inline-flex p-0.5 rounded-lg border border-studio-border bg-studio-surface"
              role="group"
              aria-label="Execution Mode"
            >
              {(
                [
                  { id: "live", label: t(locale, "modeLive"), dot: "bg-studio-emerald" },
                  { id: "dry_run", label: t(locale, "modeDryRun"), dot: "bg-studio-accent" },
                  { id: "mock", label: t(locale, "modeMock"), dot: "bg-studio-muted" },
                ] as const
              ).map((m) => {
                const selected = runMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setRunMode(m.id)}
                    className={`h-7 px-2.5 text-[11.5px] rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      selected
                        ? "bg-studio-subtle text-studio-ink font-medium"
                        : "text-studio-faint hover:text-studio-muted"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${selected ? m.dot : "bg-studio-border-strong"}`} />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Notification Inbox Button & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  const next = !notifOpen;
                  setNotifOpen(next);
                  if (next) markAllNotificationsRead();
                }}
                className="h-8 w-8 rounded-lg hover:bg-studio-surface flex items-center justify-center relative text-studio-muted hover:text-studio-ink transition-colors"
                aria-label={t(locale, "notificationsTitle")}
                title={t(locale, "notificationsTitle")}
              >
                <Bell className="w-4 h-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute top-1 end-1 min-w-[14px] h-3.5 px-1 rounded-full bg-studio-amber text-studio-ground font-mono text-[9.5px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadNotifications}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute end-0 mt-1.5 w-80 max-w-[90vw] rounded-xl border border-studio-border-strong bg-studio-surface shadow-float z-40 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-studio-border flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold">{t(locale, "notificationsTitle")}</span>
                    <button
                      type="button"
                      onClick={() => clearNotifications()}
                      className="text-[11px] text-studio-muted hover:text-studio-crimson"
                    >
                      {locale === "ar" ? "مسح الكل" : "Clear"}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-studio-border">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-studio-muted">
                        {locale === "ar" ? "لا توجد تنبيهات حالياً." : "No recent alerts."}
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (n.targetView) setActiveView(n.targetView);
                            if (n.employeeId) void selectEmployee(n.employeeId);
                            setNotifOpen(false);
                          }}
                          className="w-full px-3.5 py-2.5 text-start hover:bg-studio-subtle/60 space-y-0.5"
                        >
                          <div className="text-[12px] font-medium text-studio-ink">
                            {locale === "ar" ? n.titleAr : n.title}
                          </div>
                          {n.detail && (
                            <div dir="auto" className="text-[11px] text-studio-muted line-clamp-2">
                              {n.detail}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleUiTheme}
              className="h-8 px-2.5 rounded-lg hover:bg-studio-surface text-studio-muted hover:text-studio-ink text-[12px] font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
              title={uiTheme === "dark" ? t(locale, "themeLight") : t(locale, "themeDark")}
              aria-label="Toggle UI Theme"
            >
              {uiTheme === "dark" ? (
                <Sun className="w-3.5 h-3.5 text-studio-accent" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-studio-ink" />
              )}
              <span className="hidden xl:inline">
                {uiTheme === "dark" ? t(locale, "themeDark") : t(locale, "themeLight")}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className="h-8 px-2 rounded-lg hover:bg-studio-surface text-studio-muted hover:text-studio-ink text-[11.5px] font-mono flex items-center gap-1 whitespace-nowrap transition-colors"
              title="Switch Language / تغيير اللغة"
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{t(locale, "langToggle")}</span>
            </button>
          </div>
        </header>

        {/* Full-Bleed Canvas for Living Office, Calm Scrollable Workspace for Internal Screens */}
        <main
          className={
            activeView === "office"
              ? "flex-1 min-h-0 overflow-hidden p-0 relative"
              : "flex-1 min-h-0 overflow-y-auto px-6 py-7"
          }
        >
          {children}
        </main>
      </div>

      {/* Quick Register Project Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-studio-surface border border-studio-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">
                {locale === "ar" ? "تسجيل مجلد مشروع محلي" : "Register Local Project Workspace"}
              </h2>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="text-studio-muted hover:text-studio-ink text-[13px]"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleQuickRegister} className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-studio-muted mb-1">
                  {locale === "ar" ? "اسم المشروع" : "Project Name"}
                </label>
                <input
                  required
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="SaaS Billing Core"
                  className="w-full h-9 px-3 text-[13px] rounded-md border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-studio-muted mb-1">
                  {locale === "ar" ? "المسار الكامل على الجهاز" : "Local Folder Path"}
                </label>
                <input
                  required
                  dir="ltr"
                  value={projRoot}
                  onChange={(e) => setProjRoot(e.target.value)}
                  placeholder="D:\projects\my-app"
                  className="w-full h-9 px-3 text-[13px] font-mono rounded-md border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-studio-muted mb-1">
                  {locale === "ar" ? "وصف مختصر" : "Description"}
                </label>
                <input
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder={locale === "ar" ? "مشروع ويب / API..." : "Product repository"}
                  className="w-full h-9 px-3 text-[13px] rounded-md border border-studio-border bg-studio-blueprint focus:outline-none focus:border-studio-accent"
                />
              </div>
              {projError && (
                <p className="text-[12px] text-studio-crimson bg-studio-crimson-soft px-3 py-2 rounded border border-studio-crimson/25">
                  {projError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="h-8 px-3 text-[12px] rounded-md border border-studio-border hover:bg-studio-ground"
                >
                  {locale === "ar" ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={submittingProj}
                  className="h-8 px-3.5 text-[12px] font-medium rounded-md bg-studio-ink text-studio-ground hover:opacity-90 disabled:opacity-50"
                >
                  {submittingProj ? "..." : locale === "ar" ? "تسجيل المشروع" : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CommandPalette />
      <NotificationCenter />
    </div>
  );
}
