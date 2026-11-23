import { useState } from "react";
import { CheckCircle2, Circle, FolderPlus, GitBranch, KeyRound, Play, Sparkles, X } from "lucide-react";
import { useOfficeStore } from "../../store/office-store.ts";

const DISMISS_KEY = "vo.onboardingDismissed";

export function OnboardingStrip() {
  const {
    locale,
    projects,
    providers,
    runs,
    backupStatus,
    vaultKeys,
    setRegisterModalOpen,
    setActiveView,
    selectEmployee,
  } = useOfficeStore();

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const hasProject = projects.length > 0;
  const hasRealRuntimeOrKey =
    providers.some((p) => p.available && p.provider !== "mock") || vaultKeys.length > 0;
  const hasFirstRun = runs.length > 0;
  const hasBackup = Boolean(backupStatus?.initialized);

  if (dismissed || (hasProject && hasRealRuntimeOrKey && hasFirstRun && hasBackup)) {
    return null;
  }

  const steps = [
    {
      id: "project",
      done: hasProject,
      label: locale === "ar" ? "ربط أول مجلد مشروع" : "Register first project folder",
      Icon: FolderPlus,
      action: () => {
        setOpen(false);
        setRegisterModalOpen(true);
      },
    },
    {
      id: "provider",
      done: hasRealRuntimeOrKey,
      label: locale === "ar" ? "فحص المزودات أو الخزينة" : "Check providers or add Vault key",
      Icon: KeyRound,
      action: () => {
        setOpen(false);
        setActiveView("providers");
      },
    },
    {
      id: "run",
      done: hasFirstRun,
      label: locale === "ar" ? "إرسال أول مهمة لرامي" : "Dispatch first task to Rami",
      Icon: Play,
      action: () => {
        setOpen(false);
        void selectEmployee("general-manager");
      },
    },
    {
      id: "backup",
      done: hasBackup,
      label: locale === "ar" ? "تهيئة النسخ الاحتياطي Git" : "Initialize Git backup for company/",
      Icon: GitBranch,
      action: () => {
        setOpen(false);
        setActiveView("audit");
      },
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded-full border border-studio-border-strong bg-studio-surface/90 backdrop-blur-md text-[11.5px] font-medium text-studio-ink hover:border-studio-accent inline-flex items-center gap-2 shadow-float transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-studio-accent" />
        <span>{locale === "ar" ? "إعداد المكتب" : "Quick Setup"}</span>
        <span dir="ltr" className="font-mono text-[11px] text-studio-accent tabular-nums">
          {completedCount}/{steps.length}
        </span>
      </button>

      {open && (
        <div className="absolute top-10 start-0 z-40 w-72 rounded-xl border border-studio-border-strong bg-studio-surface p-3 shadow-float space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-studio-border">
            <span className="text-[12px] font-semibold text-studio-ink">
              {locale === "ar" ? "قائمة البدء السريع" : "Founder Setup"}
            </span>
            <button
              type="button"
              onClick={() => {
                setDismissed(true);
                setOpen(false);
                try {
                  localStorage.setItem(DISMISS_KEY, "1");
                } catch {
                  // Ignore quota issues
                }
              }}
              className="text-[11px] text-studio-faint hover:text-studio-ink inline-flex items-center gap-1"
            >
              <span>{locale === "ar" ? "إخفاء" : "Dismiss"}</span>
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1">
            {steps.map((step) => {
              const Icon = step.Icon;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={step.action}
                  className={`w-full px-2.5 py-2 rounded-lg text-start flex items-center justify-between gap-2 text-[12px] transition-colors ${
                    step.done
                      ? "bg-studio-emerald-soft/40 text-studio-emerald"
                      : "hover:bg-studio-subtle text-studio-ink"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {step.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-studio-emerald" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 shrink-0 text-studio-faint" />
                    )}
                    <span className="truncate font-medium">{step.label}</span>
                  </span>
                  <Icon className="w-3.5 h-3.5 shrink-0 opacity-65" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
