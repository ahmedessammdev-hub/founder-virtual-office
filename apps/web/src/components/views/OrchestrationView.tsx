import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  GitBranch,
  Layers,
  Mic,
  MicOff,
  Play,
  Square,
  Users,
  XCircle,
} from "lucide-react";
import { useVoiceInput } from "../../hooks/useVoiceInput.ts";
import { useOfficeStore } from "../../store/office-store.ts";

export function OrchestrationView() {
  const {
    locale,
    employees,
    projects,
    activeProjectId,
    runMode,
    taskPlans,
    meetings,
    loadOrchestrationAndHiring,
    createTaskPlan,
    cancelTaskPlan,
    createMeeting,
    cancelMeeting,
    setActiveView,
  } = useOfficeStore();

  const [tab, setTab] = useState<"dag" | "meetings">("dag");

  // DAG form state
  const [goal, setGoal] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);

  const voiceGoal = useVoiceInput(
    (transcript) => setGoal((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript)),
    locale === "ar" ? "ar-EG" : "en-US",
  );

  // Meeting form state
  const [topic, setTopic] = useState("");
  const [agenda, setAgenda] = useState("");
  const [maxRounds, setMaxRounds] = useState(2);
  const [autoCreateTasks, setAutoCreateTasks] = useState(true);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([
    "product-strategist",
    "senior-engineer",
  ]);
  const [meetingErr, setMeetingErr] = useState<string | null>(null);
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  useEffect(() => {
    void loadOrchestrationAndHiring();
  }, [loadOrchestrationAndHiring]);

  const empMap = new Map(employees.map((e) => [e.profile.id, e]));
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const toggleParticipant = (id: string) => {
    setSelectedParticipants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev,
    );
  };

  const handleLaunchDag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || creatingPlan) return;
    setPlanErr(null);
    setCreatingPlan(true);
    try {
      await createTaskPlan({
        title: planTitle.trim() || undefined,
        goal: goal.trim(),
        projectId: activeProjectId ?? null,
        mode: runMode,
        maxConcurrency,
        autoStart: true,
      });
      setGoal("");
      setPlanTitle("");
    } catch (err) {
      setPlanErr(err instanceof Error ? err.message : "Failed to create task plan");
    } finally {
      setCreatingPlan(false);
    }
  };

  const handleStartMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || selectedParticipants.length < 2 || creatingMeeting) return;
    setMeetingErr(null);
    setCreatingMeeting(true);
    try {
      await createMeeting({
        topic: topic.trim(),
        agenda: agenda.trim(),
        projectId: activeProjectId ?? null,
        participantEmployeeIds: selectedParticipants,
        maxRounds,
        mode: runMode,
        autoCreateTasks,
      });
      setTopic("");
      setAgenda("");
    } catch (err) {
      setMeetingErr(err instanceof Error ? err.message : "Failed to start meeting");
    } finally {
      setCreatingMeeting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header + Tabs */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-studio-border">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-studio-ink">
            {locale === "ar"
              ? "تنسيق المهام المتوازية وغرفة الاجتماعات"
              : "Orchestrator Task DAG & Bounded Meetings"}
          </h1>
          <p className="text-[13px] text-studio-muted mt-0.5">
            {locale === "ar"
              ? "تفكيك الأهداف لمهام متوازية باعتماديات واضحة أو عقد اجتماعات قصيرة تنتهي بمهام فورية"
              : "Decompose goals into dependency-aware parallel DAGs or run bounded meetings that auto-create Kanban tasks"}
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl border border-studio-border bg-studio-surface gap-1">
          <button
            type="button"
            onClick={() => setTab("dag")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
              tab === "dag" ? "bg-studio-subtle text-studio-ink" : "text-studio-muted hover:text-studio-ink"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>{locale === "ar" ? "مخطط المهام (Task DAG)" : "Task DAG Planner"}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("meetings")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
              tab === "meetings"
                ? "bg-studio-subtle text-studio-ink"
                : "text-studio-muted hover:text-studio-ink"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{locale === "ar" ? "غرفة الاجتماعات المقيدة" : "Bounded Meetings"}</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ORCHESTRATOR TASK DAG */}
      {tab === "dag" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleLaunchDag(e)}
            className="bg-studio-surface border border-studio-border rounded-xl p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[14px] font-semibold text-studio-ink flex items-center gap-2">
                <Layers className="w-4 h-4 text-studio-accent" />
                <span>
                  {locale === "ar"
                    ? "توجيه هدف جديد للمنسّق العام (رامي)"
                    : "Dispatch Orchestrated Goal (Rami / DAG Engine)"}
                </span>
              </div>
              <div dir="ltr" className="text-[11px] font-mono text-studio-muted flex items-center gap-2">
                <span>mode:{runMode}</span>
                <span>project:{activeProject?.name ?? "HQ"}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[12px]">
              <input
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                placeholder={locale === "ar" ? "عنوان الخطة (اختياري)..." : "Plan title (optional)..."}
                className="md:col-span-2 h-9 px-3 rounded border border-studio-border bg-studio-blueprint"
              />
              <div className="flex items-center gap-2">
                <label className="text-studio-muted whitespace-nowrap">
                  {locale === "ar" ? "سقف التوازي:" : "Max Parallel:"}
                </label>
                <select
                  aria-label="Max Parallelism"
                  value={maxConcurrency}
                  onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                  className="flex-1 h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                >
                  <option value={1}>1 concurrent</option>
                  <option value={2}>2 concurrent</option>
                  <option value={3}>3 concurrent</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="font-medium text-studio-ink">
                {locale === "ar" ? "الهدف المشترك للفريق" : "Shared Multi-Specialist Goal"}
              </span>
              <div className="flex items-center gap-1.5">
                {voiceGoal.error && (
                  <span className="text-studio-crimson text-[11px]">{voiceGoal.error}</span>
                )}
                <button
                  type="button"
                  dir="ltr"
                  disabled={voiceGoal.listening}
                  onClick={() =>
                    voiceGoal.setVoiceLang(
                      voiceGoal.voiceLang === "ar-EG" ? "en-US" : "ar-EG",
                    )
                  }
                  className="px-2 py-0.5 rounded border border-studio-border bg-studio-ground font-mono text-[10.5px] text-studio-muted hover:text-studio-ink disabled:opacity-50"
                >
                  {voiceGoal.voiceLang}
                </button>
                <button
                  type="button"
                  disabled={!voiceGoal.supported}
                  onClick={voiceGoal.toggle}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
                    voiceGoal.listening
                      ? "border-studio-crimson bg-studio-crimson-soft text-studio-crimson font-medium"
                      : "border-studio-border bg-studio-ground text-studio-muted hover:text-studio-ink disabled:opacity-45"
                  }`}
                >
                  {voiceGoal.listening ? (
                    <MicOff className="w-3 h-3" />
                  ) : (
                    <Mic className="w-3 h-3" />
                  )}
                  <span>
                    {voiceGoal.listening
                      ? locale === "ar"
                        ? "جارٍ التسجيل…"
                        : "Listening…"
                      : locale === "ar"
                        ? "إملاء صوتي"
                        : "Voice"}
                  </span>
                </button>
              </div>
            </div>

            <textarea
              required
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={
                locale === "ar"
                  ? "اكتب الهدف المطلوب تفكيكه وتوزيعه على الفريق (مثال: إطلاق صفحة الدفع مع خطة الاختبار والتسويق)..."
                  : "Describe the multi-specialist goal to decompose and execute in parallel..."
              }
              className="w-full p-3 text-[13px] rounded border border-studio-border bg-studio-blueprint resize-none"
            />

            {planErr && (
              <div className="px-3 py-2 rounded bg-studio-crimson-soft text-studio-crimson text-[12px]">
                {planErr}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creatingPlan || !goal.trim()}
                className="h-9 px-4 rounded-md bg-studio-ink text-studio-ground text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-45"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {locale === "ar" ? "تفكيك وتشغيل الخطة" : "Decompose & Run DAG"}
                </span>
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {taskPlans.map((plan) => {
              const completedCount = plan.nodes.filter((n) => n.status === "COMPLETED").length;
              return (
                <article
                  key={plan.id}
                  className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[14px] font-semibold text-studio-ink">{plan.title}</h2>
                        <span
                          dir="ltr"
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                            plan.status === "COMPLETED"
                              ? "bg-studio-emerald-soft text-studio-emerald"
                              : plan.status === "RUNNING"
                                ? "bg-studio-accent-soft text-studio-accent"
                                : plan.status === "PAUSED_APPROVAL"
                                  ? "bg-studio-amber-soft text-studio-amber"
                                  : "bg-studio-crimson-soft text-studio-crimson"
                          }`}
                        >
                          {plan.status}
                        </span>
                      </div>
                      <p dir="auto" className="mt-1 text-[12px] text-studio-muted">
                        {plan.goal}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-[11px] text-studio-muted">
                        {completedCount}/{plan.nodes.length} nodes · mode:{plan.mode} · max:{plan.maxConcurrency}
                      </span>
                      {(plan.status === "RUNNING" || plan.status === "PAUSED_APPROVAL") && (
                        <button
                          type="button"
                          onClick={() => void cancelTaskPlan(plan.id)}
                          className="h-7 px-2.5 rounded border border-studio-crimson/40 text-studio-crimson text-[11px] font-medium flex items-center gap-1"
                        >
                          <Square className="w-3 h-3" />
                          <span>{locale === "ar" ? "إيقاف" : "Cancel"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* DAG Nodes Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {plan.nodes.map((node) => {
                      const emp = empMap.get(node.assignedEmployeeId);
                      return (
                        <div
                          key={node.id}
                          className="p-3 rounded-md border border-studio-border bg-studio-blueprint space-y-1.5 flex flex-col justify-between"
                        >
                          <div className="space-y-1">
                            <div dir="ltr" className="flex items-center justify-between gap-1 text-[10px] font-mono">
                              <span className="font-semibold text-studio-muted">{node.nodeKey}</span>
                              <span
                                className={`px-1.5 py-0.5 rounded font-semibold ${
                                  node.status === "COMPLETED"
                                    ? "bg-studio-emerald-soft text-studio-emerald"
                                    : node.status === "RUNNING" || node.status === "QUEUED"
                                      ? "bg-studio-accent-soft text-studio-accent"
                                      : node.status === "WAITING_APPROVAL"
                                        ? "bg-studio-amber-soft text-studio-amber"
                                        : node.status === "FAILED"
                                          ? "bg-studio-crimson-soft text-studio-crimson"
                                          : "bg-studio-ground text-studio-muted"
                                }`}
                              >
                                {node.status}
                              </span>
                            </div>
                            <div className="text-[12.5px] font-semibold text-studio-ink leading-snug">
                              {node.title}
                            </div>
                            <div className="text-[11px] text-studio-muted">
                              {emp ? (locale === "ar" ? emp.profile.nameAr : emp.profile.name) : node.assignedEmployeeId}
                            </div>
                            {node.dependsOn.length > 0 && (
                              <div dir="ltr" className="text-[10px] font-mono text-studio-muted">
                                deps: {node.dependsOn.join(", ")}
                              </div>
                            )}
                          </div>

                          {node.outputSummary && (
                            <div
                              dir="auto"
                              className="pt-1.5 border-t border-studio-border text-[11px] text-studio-ink line-clamp-3 whitespace-pre-wrap"
                            >
                              {node.outputSummary}
                            </div>
                          )}
                          {node.errorMessage && (
                            <div className="pt-1 text-[11px] text-studio-crimson">
                              {node.errorMessage}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {plan.synthesisSummary && (
                    <div className="p-3 rounded-md border border-studio-emerald/35 bg-studio-emerald-soft/45 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-studio-emerald flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {locale === "ar" ? "الملخص التنفيذي المجمّع" : "Executive DAG Synthesis"}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveView("projects")}
                          className="text-[11px] font-semibold text-studio-accent hover:underline"
                        >
                          {locale === "ar" ? "عرض المهام على اللوحة →" : "View Linked Tasks →"}
                        </button>
                      </div>
                      <pre
                        dir="auto"
                        className="text-[12px] text-studio-ink whitespace-pre-wrap font-sans leading-relaxed"
                      >
                        {plan.synthesisSummary}
                      </pre>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: BOUNDED MEETINGS */}
      {tab === "meetings" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleStartMeeting(e)}
            className="bg-studio-surface border border-studio-border rounded-lg p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[14px] font-semibold text-studio-ink flex items-center gap-2">
                <Users className="w-4 h-4 text-studio-accent" />
                <span>
                  {locale === "ar"
                    ? "عقد اجتماع فريق مقيد (1 إلى 3 جولات فقط)"
                    : "Convene Bounded Team Meeting (Hard Cap 1–3 Rounds)"}
                </span>
              </div>
              <span dir="ltr" className="text-[11px] font-mono text-studio-muted">
                mode:{runMode} · tier1_auto
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[12px]">
              <input
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  locale === "ar" ? "موضوع الاجتماع (مثال: مراجعة خطة الإطلاق)..." : "Meeting topic..."
                }
                className="md:col-span-2 h-9 px-3 rounded border border-studio-border bg-studio-blueprint"
              />
              <select
                aria-label="Max Rounds"
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
                className="h-9 px-2.5 rounded border border-studio-border bg-studio-blueprint font-mono"
              >
                <option value={1}>1 round</option>
                <option value={2}>2 rounds</option>
                <option value={3}>3 rounds (max)</option>
              </select>
            </div>

            <textarea
              rows={2}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder={
                locale === "ar" ? "الأجندة ونقاط القرار المطلوب حسمها..." : "Agenda and decision criteria..."
              }
              className="w-full p-2.5 text-[13px] rounded border border-studio-border bg-studio-blueprint resize-none"
            />

            <div className="space-y-1.5">
              <div className="text-[12px] text-studio-muted">
                {locale === "ar" ? "المشاركون (اختر 2 إلى 5 موظفين):" : "Participants (select 2–5):"}
              </div>
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => {
                  const picked = selectedParticipants.includes(emp.profile.id);
                  return (
                    <button
                      key={emp.profile.id}
                      type="button"
                      onClick={() => toggleParticipant(emp.profile.id)}
                      className={`px-2.5 py-1 rounded-md border text-[12px] transition-colors ${
                        picked
                          ? "bg-studio-ink text-studio-surface border-studio-ink font-medium"
                          : "bg-studio-blueprint text-studio-ink border-studio-border hover:bg-studio-ground"
                      }`}
                    >
                      {locale === "ar" ? emp.profile.nameAr : emp.profile.name} ({emp.profile.avatar})
                    </button>
                  );
                })}
              </div>
            </div>

            {meetingErr && (
              <div className="px-3 py-2 rounded bg-studio-crimson-soft text-studio-crimson text-[12px]">
                {meetingErr}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-[12px] text-studio-muted">
                <input
                  type="checkbox"
                  checked={autoCreateTasks}
                  onChange={(e) => setAutoCreateTasks(e.target.checked)}
                />
                <span>
                  {locale === "ar"
                    ? "تحويل القرارات تلقائياً إلى مهام على لوحة Kanban"
                    : "Auto-create Kanban Action Items upon meeting close"}
                </span>
              </label>

              <button
                type="submit"
                disabled={creatingMeeting || selectedParticipants.length < 2 || !topic.trim()}
                className="h-9 px-4 rounded-md bg-studio-ink text-studio-ground hover:opacity-90 text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-45"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "بدء الاجتماع" : "Start Bounded Meeting"}</span>
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {meetings.map((meeting) => (
              <article
                key={meeting.id}
                className="bg-studio-surface border border-studio-border rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[14px] font-semibold text-studio-ink">{meeting.topic}</h2>
                      <span
                        dir="ltr"
                        className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                          meeting.status === "COMPLETED"
                            ? "bg-studio-emerald-soft text-studio-emerald"
                            : meeting.status === "RUNNING"
                              ? "bg-studio-accent-soft text-studio-accent"
                              : "bg-studio-crimson-soft text-studio-crimson"
                        }`}
                      >
                        {meeting.status}
                      </span>
                    </div>
                    {meeting.agenda && (
                      <p dir="auto" className="mt-1 text-[12px] text-studio-muted">
                        {meeting.agenda}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-mono text-[11px] text-studio-muted">
                      turns:{meeting.turns.length}/{meeting.maxRounds * meeting.participantEmployeeIds.length} · rounds:{meeting.maxRounds}
                    </span>
                    {meeting.status === "RUNNING" && (
                      <button
                        type="button"
                        onClick={() => void cancelMeeting(meeting.id)}
                        className="h-7 px-2.5 rounded border border-studio-crimson/40 text-studio-crimson text-[11px] flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>{locale === "ar" ? "إنهاء" : "Cancel"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Turns */}
                {meeting.turns.length > 0 && (
                  <div className="space-y-2">
                    {meeting.turns.map((turn) => {
                      const emp = empMap.get(turn.employeeId);
                      return (
                        <div
                          key={turn.id}
                          className="p-2.5 rounded border border-studio-border bg-studio-blueprint space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-semibold text-studio-ink">
                              {emp ? (locale === "ar" ? emp.profile.nameAr : emp.profile.name) : turn.employeeId}
                            </span>
                            <span dir="ltr" className="font-mono text-studio-muted">
                              Round {turn.round}/{meeting.maxRounds}
                            </span>
                          </div>
                          <p dir="auto" className="text-[12px] text-studio-ink whitespace-pre-wrap">
                            {turn.summary}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Decisions + Action Items */}
                {meeting.status === "COMPLETED" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-studio-border">
                    <div className="p-3 rounded border border-studio-border bg-studio-ground/50 space-y-1.5">
                      <div className="text-[12px] font-semibold text-studio-ink">
                        {locale === "ar" ? "القرارات" : "Recorded Decisions"}
                      </div>
                      <ul className="space-y-1 text-[12px] text-studio-ink">
                        {meeting.decisions.map((d, i) => (
                          <li key={i} dir="auto">
                            • {d}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 rounded border border-studio-emerald/30 bg-studio-emerald-soft/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-studio-emerald">
                          {locale === "ar" ? "بنود العمل (Action Items)" : "Generated Action Items"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveView("projects")}
                          className="text-[11px] font-semibold text-studio-accent hover:underline"
                        >
                          {locale === "ar" ? "فتح لوحة المهام →" : "Kanban Board →"}
                        </button>
                      </div>
                      <ul className="space-y-1 text-[12px] text-studio-ink">
                        {meeting.actionItems.map((item, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span className="truncate">{item.title}</span>
                            {item.taskId && (
                              <span dir="ltr" className="font-mono text-[10px] text-studio-emerald shrink-0">
                                task:{item.taskId.slice(0, 8)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
