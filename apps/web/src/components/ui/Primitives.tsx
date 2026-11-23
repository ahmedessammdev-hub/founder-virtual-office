import React from "react";

export function PageFrame({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`${wide ? "max-w-[1280px]" : "max-w-[1160px]"} mx-auto px-6 py-7 space-y-6`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-studio-border">
      <div className="space-y-1 min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink leading-tight">
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-studio-muted leading-snug">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export interface StatStripItem {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "accent" | "emerald" | "amber" | "crimson";
}

export function StatStrip({ items }: { items: StatStripItem[] }) {
  const colsClass =
    items.length <= 2
      ? "sm:grid-cols-2"
      : items.length === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div
      className={`grid grid-cols-1 ${colsClass} bg-studio-surface border border-studio-border rounded-xl divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse divide-studio-border overflow-hidden`}
    >
      {items.map((item) => {
        const valueTone =
          item.tone === "emerald"
            ? "text-studio-emerald"
            : item.tone === "amber"
              ? "text-studio-amber"
              : item.tone === "crimson"
                ? "text-studio-crimson"
                : item.tone === "accent"
                  ? "text-studio-accent"
                  : "text-studio-ink";
        return (
          <div key={item.label} className="px-4 py-3.5 space-y-1">
            <div className="text-[12px] text-studio-muted">{item.label}</div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                dir="ltr"
                className={`text-[22px] font-semibold font-mono tabular-nums tracking-tight ${valueTone}`}
              >
                {item.value}
              </span>
              {item.hint && (
                <span className="text-[11px] text-studio-faint truncate">{item.hint}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-studio-surface border border-studio-border rounded-xl ${className}`}
    >
      {children}
    </section>
  );
}

export function EmptyPanel({
  icon,
  message,
  action,
}: {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-studio-surface border border-studio-border rounded-xl py-12 px-6 text-center space-y-3">
      {icon && <div className="flex justify-center text-studio-faint">{icon}</div>}
      <p className="text-[13px] text-studio-muted max-w-md mx-auto">{message}</p>
      {action && <div className="pt-1 flex justify-center">{action}</div>}
    </div>
  );
}
