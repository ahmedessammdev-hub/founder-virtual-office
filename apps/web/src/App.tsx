import { Suspense, lazy, useEffect, useState } from "react";
import type { Task } from "@virtual-office/shared";
import { AppShell } from "./components/AppShell.tsx";
import { EmployeeDrawer } from "./components/drawer/EmployeeDrawer.tsx";
import { OfficeFloorplan } from "./components/office/OfficeFloorplan.tsx";
import { t } from "./i18n/translations.ts";
import { useOfficeStore } from "./store/office-store.ts";

const ApprovalsView = lazy(() =>
  import("./components/views/ApprovalsView.tsx").then((m) => ({ default: m.ApprovalsView })),
);
const AuditView = lazy(() =>
  import("./components/views/AuditView.tsx").then((m) => ({ default: m.AuditView })),
);
const AutomationView = lazy(() =>
  import("./components/views/AutomationView.tsx").then((m) => ({ default: m.AutomationView })),
);
const HiringView = lazy(() =>
  import("./components/views/HiringView.tsx").then((m) => ({ default: m.HiringView })),
);
const McpManagerView = lazy(() =>
  import("./components/views/McpManagerView.tsx").then((m) => ({ default: m.McpManagerView })),
);
const MemoryView = lazy(() =>
  import("./components/views/MemoryView.tsx").then((m) => ({ default: m.MemoryView })),
);
const OrchestrationView = lazy(() =>
  import("./components/views/OrchestrationView.tsx").then((m) => ({ default: m.OrchestrationView })),
);
const ProjectsTasksView = lazy(() =>
  import("./components/views/ProjectsTasksView.tsx").then((m) => ({ default: m.ProjectsTasksView })),
);
const ProvidersView = lazy(() =>
  import("./components/views/ProvidersView.tsx").then((m) => ({ default: m.ProvidersView })),
);

export function App() {
  const {
    locale,
    activeView,
    setActiveView,
    setActiveProjectId,
    selectEmployee,
    loading,
    connectionError,
    bootstrap,
  } = useOfficeStore();

  const [prefillPrompt, setPrefillPrompt] = useState<string>("");
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  const handleDispatchTask = (task: Task) => {
    if (!task.assignedEmployeeId) return;
    if (task.projectId) {
      setActiveProjectId(task.projectId);
    }
    setLinkedTaskId(task.id);
    setPrefillPrompt(
      task.description ? `${task.title}\n\n${task.description}` : task.title,
    );
    setActiveView("office");
    void selectEmployee(task.assignedEmployeeId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-studio-ground flex items-center justify-center p-6">
        <div className="text-[14px] text-studio-muted">{t(locale, "connectingTitle")}</div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="min-h-screen bg-studio-ground flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-studio-surface border border-studio-border rounded-lg p-6 space-y-3 text-center">
          <h1 className="text-[16px] font-semibold text-studio-ink">
            {t(locale, "connectingTitle")}
          </h1>
          <p className="text-[13px] text-studio-muted">{t(locale, "connectingHint")}</p>
          <p className="text-[12px] font-mono text-studio-crimson">{connectionError}</p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="h-9 px-4 rounded-lg bg-studio-ink text-studio-ground text-[13px] font-medium hover:opacity-90"
          >
            {t(locale, "retryBtn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      {activeView === "office" && <OfficeFloorplan />}
      <Suspense
        fallback={
          <div className="max-w-6xl mx-auto py-12 text-center text-[13px] text-studio-muted">
            {locale === "ar" ? "جارٍ تحميل الشاشة..." : "Loading view..."}
          </div>
        }
      >
        {activeView === "orchestration" && <OrchestrationView />}
        {activeView === "hiring" && <HiringView />}
        {activeView === "automation" && <AutomationView />}
        {activeView === "approvals" && <ApprovalsView />}
        {activeView === "projects" && (
          <ProjectsTasksView onDispatchTask={handleDispatchTask} />
        )}
        {activeView === "memory" && <MemoryView />}
        {activeView === "mcps" && <McpManagerView />}
        {activeView === "providers" && <ProvidersView />}
        {activeView === "audit" && <AuditView />}
      </Suspense>

      <EmployeeDrawer
        prefillPrompt={prefillPrompt}
        linkedTaskId={linkedTaskId}
        onClearPrefill={() => {
          setPrefillPrompt("");
          setLinkedTaskId(null);
        }}
      />
    </AppShell>
  );
}
export default App;
