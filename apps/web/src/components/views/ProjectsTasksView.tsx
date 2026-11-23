import React, { useState } from "react";
import { FolderGit2, FolderOpen, Play, Plus, Trash2 } from "lucide-react";
import type { Task, TaskStatus } from "@virtual-office/shared";
import { t } from "../../i18n/translations.ts";
import { useOfficeStore } from "../../store/office-store.ts";

const KANBAN_COLUMNS: Array<{ id: TaskStatus; labelAr: string; labelEn: string }> = [
  { id: "todo", labelAr: "قيد الانتظار", labelEn: "To Do" },
  { id: "in_progress", labelAr: "جاري التنفيذ", labelEn: "In Progress" },
  { id: "waiting_approval", labelAr: "بانتظار موافقة", labelEn: "Waiting Approval" },
  { id: "review", labelAr: "مراجعة", labelEn: "Review" },
  { id: "done", labelAr: "مكتمل", labelEn: "Done" },
];

export function ProjectsTasksView({
  onDispatchTask,
}: {
  onDispatchTask: (task: Task) => void;
}) {
  const {
    locale,
    projects,
    tasks,
    employees,
    activeProjectId,
    setActiveProjectId,
    registerProject,
    removeProject,
    createTask,
    updateTaskStatus,
  } = useOfficeStore();

  const [showProjForm, setShowProjForm] = useState(false);
  const [projName, setProjName] = useState("");
  const [projRoot, setProjRoot] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projErr, setProjErr] = useState<string | null>(null);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskEmpId, setTaskEmpId] = useState(employees[0]?.profile.id ?? "general-manager");
  const [taskProjId, setTaskProjId] = useState<string>(activeProjectId ?? "");

  const empMap = new Map(employees.map((e) => [e.profile.id, e]));
  const visibleTasks = activeProjectId
    ? tasks.filter((item) => item.projectId === activeProjectId)
    : tasks;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjErr(null);
    try {
      await registerProject({
        name: projName.trim(),
        rootPath: projRoot.trim(),
        description: projDesc.trim(),
      });
      setProjName("");
      setProjRoot("");
      setProjDesc("");
      setShowProjForm(false);
    } catch (err) {
      setProjErr(err instanceof Error ? err.message : "Failed to register project");
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    await createTask({
      title: taskTitle.trim(),
      description: taskDesc.trim(),
      assignedEmployeeId: taskEmpId || null,
      projectId: taskProjId || activeProjectId || null,
      status: "todo",
      priority: "medium",
    });
    setTaskTitle("");
    setTaskDesc("");
    setShowTaskForm(false);
  };

  return (
    <div className="max-w-[1440px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {t(locale, "projectsTitle")}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">{t(locale, "projectsQuestion")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProjForm((v) => !v)}
            className="h-8 px-3 rounded-md border border-studio-border bg-studio-surface hover:bg-studio-subtle text-[12px] font-medium flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t(locale, "registerProjectBtn").replace(/^\+\s*/, "")}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowTaskForm((v) => !v)}
            className="h-8 px-3 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1 hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t(locale, "newTaskBtn").replace(/^\+\s*/, "")}</span>
          </button>
        </div>
      </div>

      {/* Inline Register Project Form */}
      {showProjForm && (
        <form
          onSubmit={handleRegister}
          className="p-4 bg-studio-surface border border-studio-border rounded-xl grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "اسم المشروع" : "Name"}
            </label>
            <input
              required
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
              placeholder="My SaaS"
            />
          </div>
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "مسار المجلد" : "Root Path"}
            </label>
            <input
              required
              dir="ltr"
              value={projRoot}
              onChange={(e) => setProjRoot(e.target.value)}
              className="w-full h-8 px-2.5 text-[12px] font-mono rounded border border-studio-border bg-studio-blueprint"
              placeholder="D:\projects\app"
            />
          </div>
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "الوصف" : "Description"}
            </label>
            <input
              value={projDesc}
              onChange={(e) => setProjDesc(e.target.value)}
              className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-8 px-3.5 rounded bg-studio-ink text-studio-surface text-[12px] font-medium"
            >
              {locale === "ar" ? "حفظ" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowProjForm(false)}
              className="h-8 px-3 rounded border border-studio-border text-[12px]"
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
          {projErr && (
            <div className="md:col-span-4 text-[12px] text-studio-crimson">{projErr}</div>
          )}
        </form>
      )}

      {/* Inline New Task Form */}
      {showTaskForm && (
        <form
          onSubmit={handleCreateTask}
          className="p-4 bg-studio-surface border border-studio-border rounded-lg grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "عنوان المهمة" : "Task Title"}
            </label>
            <input
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
              placeholder={locale === "ar" ? "مثال: مراجعة API الدفع" : "Review billing API"}
            />
          </div>
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "الموظف المسؤول" : "Assignee"}
            </label>
            <select
              value={taskEmpId}
              onChange={(e) => setTaskEmpId(e.target.value)}
              className="w-full h-8 px-2 text-[12px] rounded border border-studio-border bg-studio-blueprint"
            >
              {employees.map((e) => (
                <option key={e.profile.id} value={e.profile.id}>
                  {locale === "ar" ? e.profile.nameAr : e.profile.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-studio-muted mb-1">
              {locale === "ar" ? "المشروع" : "Project"}
            </label>
            <select
              value={taskProjId}
              onChange={(e) => setTaskProjId(e.target.value)}
              className="w-full h-8 px-2 text-[12px] rounded border border-studio-border bg-studio-blueprint"
            >
              <option value="">{t(locale, "companyWorkspace")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-8 px-3.5 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-medium"
            >
              {locale === "ar" ? "إضافة" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowTaskForm(false)}
              className="h-8 px-3 rounded border border-studio-border text-[12px]"
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
          <div className="md:col-span-4">
            <input
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
              placeholder={locale === "ar" ? "تفاصيل ومعايير التسليم..." : "Task instructions..."}
              className="w-full h-8 px-2.5 text-[12px] rounded border border-studio-border bg-studio-blueprint"
            />
          </div>
        </form>
      )}

      {/* Registered Workspaces Strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {projects.length === 0 ? (
          <div className="md:col-span-3 p-4 bg-studio-surface border border-studio-border rounded-lg text-[13px] text-studio-muted">
            {locale === "ar"
              ? "لا توجد مشاريع مسجلة بعد — اضغط «تسجيل مشروع» لربط أي مجلد كود أو منتج."
              : "No projects registered yet — click Register Project to connect a local repository or folder."}
          </div>
        ) : (
          projects.map((proj) => {
            const selected = activeProjectId === proj.id;
            return (
              <div
                key={proj.id}
                className={`p-3.5 bg-studio-surface border rounded-lg flex flex-col justify-between gap-2 ${
                  selected ? "border-studio-accent" : "border-studio-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveProjectId(selected ? null : proj.id)}
                    className="text-start min-w-0 flex-1"
                  >
                    <div className="flex items-center gap-2">
                      {proj.isGitRepo ? (
                        <FolderGit2 className="w-4 h-4 text-studio-emerald shrink-0" />
                      ) : (
                        <FolderOpen className="w-4 h-4 text-studio-amber shrink-0" />
                      )}
                      <span className="font-semibold text-[13px] truncate">{proj.name}</span>
                    </div>
                    <div dir="ltr" className="mt-1 font-mono text-[11px] text-studio-muted truncate">
                      {proj.rootPath}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeProject(proj.id)}
                    className="p-1 text-studio-faint hover:text-studio-crimson"
                    title="Remove project"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-studio-muted">
                  <span>
                    {proj.isGitRepo ? `Git (${proj.defaultBranch ?? "HEAD"})` : "Non-Git (Write Lock)"}
                  </span>
                  <span>${proj.dailyBudgetUsd}/day</span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* 5-Column Kanban Board */}
      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {KANBAN_COLUMNS.map((col) => {
          const colTasks = visibleTasks.filter((item) => item.status === col.id);
          return (
            <div
              key={col.id}
              className="bg-studio-surface border border-studio-border rounded-xl flex flex-col min-h-[320px]"
            >
              <div className="px-3 py-2 border-b border-studio-border flex items-center justify-between text-[12px] font-semibold">
                <span>{locale === "ar" ? col.labelAr : col.labelEn}</span>
                <span className="font-mono text-[11px] text-studio-muted">{colTasks.length}</span>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {colTasks.map((task) => {
                  const emp = task.assignedEmployeeId
                    ? empMap.get(task.assignedEmployeeId)
                    : undefined;
                  return (
                    <div
                      key={task.id}
                      className="p-2.5 rounded border border-studio-border bg-studio-blueprint space-y-2"
                    >
                      <div className="text-[12.5px] font-semibold text-studio-ink leading-snug">
                        {task.title}
                      </div>
                      {task.description && (
                        <div className="text-[11px] text-studio-muted line-clamp-2">
                          {task.description}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="text-studio-muted truncate">
                          {emp ? (locale === "ar" ? emp.profile.nameAr : emp.profile.name) : "—"}
                        </span>
                        <select
                          aria-label="Task status"
                          value={task.status}
                          onChange={(e) =>
                            void updateTaskStatus(task.id, e.target.value as TaskStatus)
                          }
                          className="h-6 px-1 rounded border border-studio-border bg-studio-surface text-[10px] font-mono"
                        >
                          {KANBAN_COLUMNS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      {task.assignedEmployeeId && (
                        <button
                          type="button"
                          onClick={() => onDispatchTask(task)}
                          className="w-full h-7 rounded border border-studio-border bg-studio-surface text-studio-ink hover:bg-studio-ink hover:text-studio-ground text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          <span>{t(locale, "runWithEmployee")}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
