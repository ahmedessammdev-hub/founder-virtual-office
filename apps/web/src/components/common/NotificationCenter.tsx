import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import { useOfficeStore, type OfficeNotification } from "../../store/office-store.ts";

function levelStyles(level: OfficeNotification["level"]) {
  if (level === "success") {
    return {
      border: "border-studio-emerald/40",
      bg: "bg-studio-emerald-soft/90",
      text: "text-studio-emerald",
      Icon: CheckCircle2,
    };
  }
  if (level === "warning") {
    return {
      border: "border-studio-amber/40",
      bg: "bg-studio-amber-soft/90",
      text: "text-studio-amber",
      Icon: AlertTriangle,
    };
  }
  if (level === "error") {
    return {
      border: "border-studio-crimson/40",
      bg: "bg-studio-crimson-soft/90",
      text: "text-studio-crimson",
      Icon: ShieldAlert,
    };
  }
  return {
    border: "border-studio-accent/35",
    bg: "bg-studio-surface",
    text: "text-studio-accent",
    Icon: Info,
  };
}

export function NotificationCenter() {
  const { locale, toasts, dismissToast, setActiveView, selectEmployee } = useOfficeStore();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        dismissToast(toast.id);
      }, 5_500),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { border, bg, text, Icon } = levelStyles(toast.level);
        const clickable = Boolean(toast.targetView || toast.employeeId);
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border ${border} ${bg} bg-studio-surface/95 backdrop-blur-md px-3.5 py-2.5 shadow-float flex items-start justify-between gap-2.5`}
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (toast.targetView) setActiveView(toast.targetView);
                if (toast.employeeId) void selectEmployee(toast.employeeId);
                dismissToast(toast.id);
              }}
              className={`flex items-start gap-2 text-start flex-1 min-w-0 ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${text}`} />
              <div className="min-w-0 space-y-0.5">
                <div className="text-[12.5px] font-semibold text-studio-ink leading-tight">
                  {locale === "ar" ? toast.titleAr : toast.title}
                </div>
                {toast.detail && (
                  <div dir="auto" className="text-[11.5px] text-studio-muted line-clamp-2">
                    {toast.detail}
                  </div>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="p-0.5 text-studio-muted hover:text-studio-ink shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
