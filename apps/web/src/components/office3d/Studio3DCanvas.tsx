import { Canvas } from "@react-three/fiber";
import {
  Camera,
  Eye,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeFloorplan } from "@virtual-office/shared";
import { selectEmployeeLiveState, useOfficeStore } from "../../store/office-store.ts";
import { OfficeScene } from "./OfficeScene.tsx";
import type { CameraPresetTarget } from "./CameraRig.tsx";
import type { ProximityPromptTarget } from "./FirstPersonController.tsx";
import {
  createInitialAgentStates,
  type AmbientLifeMode,
  type AvatarAgentState,
  type EmployeeBehaviorInput,
} from "./behavior-controller.ts";
import { getDeskPoseWorld, getMeetingTableWorld } from "./coordinates.ts";
import { buildOfficeNavGrid } from "./navgrid.ts";

interface Studio3DCanvasProps {
  floorplan: OfficeFloorplan;
  viewMode: "3d_orbit" | "3d_fp";
  onExitTo2D: () => void;
}

export function Studio3DCanvas({
  floorplan,
  viewMode,
  onExitTo2D,
}: Studio3DCanvasProps) {
  const {
    locale,
    employees,
    company,
    runs,
    approvals,
    meetings,
    taskPlans,
    eventsByRunId,
    selectedEmployeeId,
    reducedMotion,
    lightingMode3D,
    qualityTier3D,
    ambientLifeMode,
    avatarRendererMode,
    setLightingMode3D,
    setQualityTier3D,
    setAmbientLifeMode,
    setAvatarRendererMode,
    selectEmployee,
    setActiveView,
  } = useOfficeStore();

  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const [proximityTarget, setProximityTarget] = useState<ProximityPromptTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" ? document.visibilityState === "hidden" : false,
  );
  const [contextLost, setContextLost] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetTarget>({
    seq: 0,
    position: [6.5, 7.2, 8.0],
    target: [0, 0.45, 0],
  });

  const cleanupContextListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onVisibility = () => {
      setTabHidden(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupContextListenersRef.current?.();
      cleanupContextListenersRef.current = null;
    };
  }, []);

  const navGrid = useMemo(() => buildOfficeNavGrid(floorplan), [floorplan]);

  const agentsMapRef = useRef<Record<string, AvatarAgentState>>({});

  useEffect(() => {
    const initial = createInitialAgentStates(employees, floorplan);
    const next: Record<string, AvatarAgentState> = {};
    for (const emp of employees) {
      const id = emp.profile.id;
      next[id] = agentsMapRef.current[id] ?? initial[id]!;
    }
    agentsMapRef.current = next;
  }, [employees, floorplan]);

  if (Object.keys(agentsMapRef.current).length === 0 && employees.length > 0) {
    agentsMapRef.current = createInitialAgentStates(employees, floorplan);
  }

  const deptColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of company?.departments ?? []) {
      map[d.id] = d.color;
    }
    return map;
  }, [company?.departments]);

  const runningMeetingIds = useMemo(() => {
    const set = new Set<string>();
    const active = meetings.find((m) => m.status === "RUNNING");
    if (active) {
      set.add(active.facilitatorEmployeeId);
      for (const p of active.participantEmployeeIds) set.add(p);
    }
    return set;
  }, [meetings]);

  const { behaviorInputs, statusByEmployeeId, activeToolByEmployeeId } = useMemo(() => {
    const inputs: EmployeeBehaviorInput[] = [];
    const statusMap: Record<string, "working" | "queued" | "waiting_approval" | "failed" | "idle" | "meeting"> = {};
    const toolMap: Record<string, string | null> = {};

    for (const emp of employees) {
      const live = selectEmployeeLiveState({ runs, approvals }, emp.profile.id);
      const isLiveActive = live.status === "working" || live.status === "waiting_approval";
      const runEvents =
        isLiveActive && live.activeRun ? (eventsByRunId[live.activeRun.id] ?? []) : [];
      let latestTool: string | null = null;
      for (let i = runEvents.length - 1; i >= 0; i -= 1) {
        const ev = runEvents[i]?.event;
        if (ev?.type === "tool_call") {
          latestTool = ev.toolName;
          break;
        }
      }

      const opStatus =
        live.status !== "waiting_approval" && runningMeetingIds.has(emp.profile.id)
          ? "meeting"
          : live.status;

      inputs.push({
        employeeId: emp.profile.id,
        deskId: emp.profile.deskId,
        liveStatus: live.status,
        activeToolName: latestTool,
      });
      statusMap[emp.profile.id] = opStatus;
      toolMap[emp.profile.id] = latestTool;
    }

    return {
      behaviorInputs: inputs,
      statusByEmployeeId: statusMap,
      activeToolByEmployeeId: toolMap,
    };
  }, [employees, runs, approvals, eventsByRunId, runningMeetingIds]);

  const focusEmployee = useCallback(
    (empId: string) => {
      const ag = agentsMapRef.current[empId];
      const desk = floorplan.desks.find((d) => d.employeeId === empId);
      const targetPt = ag?.position ?? (desk ? getDeskPoseWorld(desk, floorplan).center : { x: 0, y: 0, z: 0 });
      setCameraPreset((prev) => ({
        seq: prev.seq + 1,
        target: [targetPt.x, 0.9, targetPt.z],
        position: [targetPt.x + 2.8, 3.6, targetPt.z + 3.4],
      }));
    },
    [floorplan],
  );

  const focusOverview = useCallback(() => {
    setCameraPreset((prev) => ({
      seq: prev.seq + 1,
      position: [6.5, 7.2, 8.0],
      target: [0, 0.45, 0],
    }));
  }, []);

  const focusMeetingRoom = useCallback(() => {
    const table = getMeetingTableWorld(floorplan);
    setCameraPreset((prev) => ({
      seq: prev.seq + 1,
      position: [table.center.x + 3.6, 4.2, table.center.z + 3.8],
      target: [table.center.x, 0.7, table.center.z],
    }));
  }, [floorplan]);

  const focusLatestApproval = useCallback(() => {
    const pending = approvals.find((a) => a.status === "PENDING");
    if (pending) {
      focusEmployee(pending.employeeId);
      void selectEmployee(pending.employeeId);
    } else {
      setActiveView("approvals");
    }
  }, [approvals, focusEmployee, selectEmployee, setActiveView]);

  const handleOpenMeetingView = useCallback(() => {
    setActiveView("orchestration");
  }, [setActiveView]);

  const handleActivateProximity = useCallback(
    (target: ProximityPromptTarget) => {
      if (target.kind === "employee") {
        void selectEmployee(target.id);
      } else {
        setActiveView("orchestration");
      }
    },
    [selectEmployee, setActiveView],
  );

  const dpr: [number, number] | number =
    qualityTier3D === "high" ? [1, 1.5] : qualityTier3D === "balanced" ? [1, 1.25] : 1;

  return (
    <div className="relative h-full w-full min-h-[420px] bg-studio-ground select-none overflow-hidden">
      <Canvas
        shadows={qualityTier3D !== "eco"}
        dpr={dpr}
        frameloop={tabHidden || contextLost ? "demand" : "always"}
        camera={{ position: [6.5, 7.2, 8.0], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          cleanupContextListenersRef.current?.();
          const el = gl.domElement;
          const onLost = (e: Event) => {
            e.preventDefault();
            setContextLost(true);
          };
          const onRestored = () => {
            setContextLost(false);
          };
          el.addEventListener("webglcontextlost", onLost);
          el.addEventListener("webglcontextrestored", onRestored);
          cleanupContextListenersRef.current = () => {
            el.removeEventListener("webglcontextlost", onLost);
            el.removeEventListener("webglcontextrestored", onRestored);
          };
        }}
      >
        <OfficeScene
          floorplan={floorplan}
          navGrid={navGrid}
          employees={employees}
          deptColorMap={deptColorMap}
          meetings={meetings}
          taskPlans={taskPlans}
          agentsMapRef={agentsMapRef}
          behaviorInputs={behaviorInputs}
          statusByEmployeeId={statusByEmployeeId}
          activeToolByEmployeeId={activeToolByEmployeeId}
          viewMode={viewMode}
          lightingMode={lightingMode3D}
          qualityTier={qualityTier3D}
          ambientMode={ambientLifeMode}
          avatarRendererMode={avatarRendererMode}
          reducedMotion={reducedMotion}
          locale={locale}
          selectedEmployeeId={selectedEmployeeId}
          hoveredEmployeeId={hoveredEmployeeId}
          cameraPreset={cameraPreset}
          onSelectEmployee={(id) => void selectEmployee(id)}
          onHoverChange={setHoveredEmployeeId}
          onOpenMeetingView={handleOpenMeetingView}
          onProximityChange={setProximityTarget}
          onActivateProximity={handleActivateProximity}
        />
      </Canvas>

      {/* Whisper-Quiet Top-End Camera & Studio Settings Control Pill */}
      <div className="pointer-events-none absolute top-3.5 end-4 z-20 flex flex-col items-end gap-2">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-studio-border-strong bg-studio-surface/90 backdrop-blur-md px-2 py-1 text-[11.5px] text-studio-ink shadow-float">
          {viewMode === "3d_orbit" ? (
            <>
              <span className="px-1.5 text-studio-faint">
                <Camera className="w-3.5 h-3.5" />
              </span>
              <button
                type="button"
                onClick={focusOverview}
                className="px-2 py-1 rounded-full hover:bg-studio-subtle transition-colors"
              >
                {locale === "ar" ? "نظرة عامة" : "Overview"}
              </button>
              <button
                type="button"
                onClick={focusMeetingRoom}
                className="px-2 py-1 rounded-full hover:bg-studio-subtle transition-colors inline-flex items-center gap-1"
              >
                <Users className="w-3 h-3 text-studio-accent" />
                <span>{locale === "ar" ? "غرفة الاجتماعات" : "Boardroom"}</span>
              </button>
              <button
                type="button"
                onClick={focusLatestApproval}
                className="px-2 py-1 rounded-full hover:bg-studio-subtle text-studio-amber transition-colors inline-flex items-center gap-1"
              >
                <UserCheck className="w-3 h-3" />
                <span>{locale === "ar" ? "آخر موافقة" : "Approval"}</span>
              </button>
            </>
          ) : (
            <div className="px-2.5 py-1 inline-flex items-center gap-2 text-studio-ink">
              <Eye className="w-3.5 h-3.5 text-studio-emerald" />
              <span>
                {locale === "ar"
                  ? "W/A/S/D للحركة · اسحب للالتفاف"
                  : "W/A/S/D move · Drag to look"}
              </span>
            </div>
          )}

          <div className="h-4 w-px bg-studio-border mx-0.5" />

          <button
            type="button"
            onClick={() => setLightingMode3D(lightingMode3D === "day" ? "night" : "day")}
            aria-label={locale === "ar" ? "تبديل إضاءة 3D" : "Toggle 3D lighting"}
            className="px-2 py-1 rounded-full hover:bg-studio-subtle inline-flex items-center gap-1 transition-colors"
          >
            {lightingMode3D === "day" ? (
              <>
                <Sun className="w-3.5 h-3.5 text-studio-amber" />
                <span>{locale === "ar" ? "نهار" : "Day"}</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-studio-accent" />
                <span>{locale === "ar" ? "مسائي" : "Evening"}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label={locale === "ar" ? "إعدادات الاستوديو" : "3D Studio Settings"}
            className={`px-2 py-1 rounded-full inline-flex items-center gap-1 transition-colors ${
              settingsOpen ? "bg-studio-subtle text-studio-accent" : "hover:bg-studio-subtle text-studio-muted hover:text-studio-ink"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{locale === "ar" ? "البيئة" : "Studio"}</span>
          </button>
        </div>

        {/* Collapsible 3D Studio Environment Popover */}
        {settingsOpen && (
          <div className="pointer-events-auto w-64 rounded-xl border border-studio-border-strong bg-studio-surface/95 backdrop-blur-md p-3.5 shadow-float space-y-3 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-studio-muted">
                <Sparkles className="w-3.5 h-3.5 text-studio-emerald" />
                <span>{locale === "ar" ? "حياة المكتب" : "Ambient Life"}</span>
              </span>
              <select
                aria-label={locale === "ar" ? "حياة المكتب" : "Ambient Life"}
                value={ambientLifeMode}
                onChange={(e) => setAmbientLifeMode(e.target.value as AmbientLifeMode)}
                className="h-7 px-2 rounded-md border border-studio-border bg-studio-ground text-studio-ink text-[11.5px]"
              >
                <option value="quiet">{locale === "ar" ? "هادئ" : "Quiet"}</option>
                <option value="balanced">{locale === "ar" ? "متوازن" : "Balanced"}</option>
                <option value="lively">{locale === "ar" ? "حيوي" : "Lively"}</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-studio-muted">
                <Monitor className="w-3.5 h-3.5 text-studio-accent" />
                <span>{locale === "ar" ? "جودة العرض" : "Render Quality"}</span>
              </span>
              <select
                aria-label={locale === "ar" ? "جودة 3D" : "3D Quality"}
                value={qualityTier3D}
                onChange={(e) => setQualityTier3D(e.target.value as "high" | "balanced" | "eco")}
                className="h-7 px-2 rounded-md border border-studio-border bg-studio-ground text-studio-ink text-[11.5px]"
              >
                <option value="high">High (RTX)</option>
                <option value="balanced">Balanced</option>
                <option value="eco">Eco (Battery)</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-studio-muted">
                {locale === "ar" ? "محول الشخصيات" : "Avatars"}
              </span>
              <select
                aria-label={locale === "ar" ? "محول الشخصيات" : "Avatar Adapter"}
                value={avatarRendererMode}
                onChange={(e) =>
                  setAvatarRendererMode(e.target.value as "hybrid" | "rigged_all" | "procedural")
                }
                className="h-7 px-2 rounded-md border border-studio-border bg-studio-ground text-studio-ink text-[11.5px]"
              >
                <option value="hybrid">{locale === "ar" ? "هجين (GLB+منحوت)" : "Hybrid"}</option>
                <option value="rigged_all">{locale === "ar" ? "GLB الكل" : "Rigged GLB"}</option>
                <option value="procedural">{locale === "ar" ? "منحوت خفيف" : "Sculpted"}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* First-Person Proximity Action Prompt (placed comfortably above bottom dock) */}
      {viewMode === "3d_fp" && proximityTarget && (
        <div className="pointer-events-auto absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <button
            type="button"
            onClick={() => handleActivateProximity(proximityTarget)}
            className="px-4 py-2 rounded-full border border-studio-accent/50 bg-studio-surface/95 text-studio-accent text-[12.5px] font-medium shadow-float backdrop-blur-md hover:bg-studio-subtle transition-colors"
          >
            {proximityTarget.label}
          </button>
        </div>
      )}

      {contextLost && (
        <div className="absolute inset-0 bg-studio-ground/92 flex flex-col items-center justify-center gap-3 text-studio-ink z-30">
          <p className="text-[13px] text-studio-muted">
            {locale === "ar"
              ? "توقف سياق WebGL مؤقتاً لحماية الذاكرة"
              : "WebGL context paused temporarily"}
          </p>
          <button
            type="button"
            onClick={onExitTo2D}
            className="h-8 px-3.5 rounded-lg bg-studio-ink text-studio-ground text-[12px] font-medium"
          >
            {locale === "ar" ? "العودة إلى 2D" : "Switch to 2D"}
          </button>
        </div>
      )}
    </div>
  );
}
