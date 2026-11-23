import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  CheckCircle2,
  Compass,
  Grid,
  Layers,
  Map as MapIcon,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  ShieldAlert,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  Department,
  DeskRotation,
  FloorplanDesk,
  FloorplanTheme,
  FloorplanZone,
} from "@virtual-office/shared";
import { t } from "../../i18n/translations.ts";
import { selectEmployeeLiveState, useOfficeStore } from "../../store/office-store.ts";
import { OnboardingStrip } from "../common/OnboardingStrip.tsx";
import { WebGLErrorBoundary } from "../office3d/WebGLErrorBoundary.tsx";

const Studio3DCanvas = lazy(() =>
  import("../office3d/Studio3DCanvas.tsx").then((m) => ({ default: m.Studio3DCanvas })),
);

const DEFAULT_DEPT_COLORS: Record<string, string> = {
  executive: "#6370F5",
  people: "#EC4899",
  engineering: "#16B88B",
  product: "#F59E0B",
  growth: "#06B6D4",
};

interface ThemePalette {
  label: string;
  labelAr: string;
  canvasBg: string;
  gridDot: string;
  wallFill: string;
  wallStroke: string;
  zoneFill: string;
  loungeFill: string;
  meetingFill: string;
  deskFill: string;
  deskStroke: string;
  inkText: string;
  mutedText: string;
  furnitureFill: string;
  dividerStroke: string;
}

const LIGHT_PALETTES: Record<FloorplanTheme, ThemePalette> = {
  sunlit_studio: {
    label: "Sunlit Studio",
    labelAr: "استوديو مشرق",
    canvasBg: "#FAF9F5",
    gridDot: "#D8D3C8",
    wallFill: "#FFFFFF",
    wallStroke: "#C9C2B4",
    zoneFill: "#FFFFFF",
    loungeFill: "#F4F1EA",
    meetingFill: "#F7F8FC",
    deskFill: "#FFFFFF",
    deskStroke: "#D6D0C4",
    inkText: "#1A1917",
    mutedText: "#6B675E",
    furnitureFill: "#E8E4DA",
    dividerStroke: "#EFECE4",
  },
  warm_sand: {
    label: "Warm Sand",
    labelAr: "رمال دافئة",
    canvasBg: "#F7F1E5",
    gridDot: "#D5C6AE",
    wallFill: "#FFFDF8",
    wallStroke: "#C6B69C",
    zoneFill: "#FFFCF5",
    loungeFill: "#EFE6D5",
    meetingFill: "#FBF7EC",
    deskFill: "#FFFDF9",
    deskStroke: "#D4C4AA",
    inkText: "#1A1917",
    mutedText: "#6B675E",
    furnitureFill: "#EADFCB",
    dividerStroke: "#EDE3D2",
  },
  blueprint_slate: {
    label: "Blueprint Slate",
    labelAr: "مخطط هندسي",
    canvasBg: "#EEF2F7",
    gridDot: "#CBD5E1",
    wallFill: "#F8FAFD",
    wallStroke: "#94A3B8",
    zoneFill: "#FFFFFF",
    loungeFill: "#E8EEF5",
    meetingFill: "#EDF2FA",
    deskFill: "#FFFFFF",
    deskStroke: "#CBD5E1",
    inkText: "#0F172A",
    mutedText: "#475569",
    furnitureFill: "#DCE5F1",
    dividerStroke: "#E2E8F0",
  },
};

const DARK_STUDIO_PALETTE: ThemePalette = {
  label: "Obsidian Studio",
  labelAr: "استوديو أوبسيديان",
  canvasBg: "#09090B",
  gridDot: "#202026",
  wallFill: "#101013",
  wallStroke: "#27272E",
  zoneFill: "#131317",
  loungeFill: "#111115",
  meetingFill: "#141419",
  deskFill: "#19191E",
  deskStroke: "#2C2C34",
  inkText: "#F4F4F6",
  mutedText: "#A1A1AA",
  furnitureFill: "#202027",
  dividerStroke: "#25252C",
};

interface LayoutSnapshot {
  theme: FloorplanTheme;
  width: number;
  height: number;
  departments: Department[];
  zones: FloorplanZone[];
  desks: FloorplanDesk[];
}

function cloneSnapshot(s: LayoutSnapshot): LayoutSnapshot {
  return {
    theme: s.theme,
    width: s.width,
    height: s.height,
    departments: s.departments.map((d) => ({ ...d })),
    zones: s.zones.map((z) => ({ ...z })),
    desks: s.desks.map((d) => ({ ...d })),
  };
}

function snapCoord(value: number, enabled: boolean): number {
  const step = 20;
  return enabled ? Math.round(value / step) * step : Math.round(value);
}

export function OfficeFloorplan() {
  const {
    locale,
    uiTheme,
    officeViewMode,
    setOfficeViewMode,
    company,
    employees,
    runs,
    approvals,
    providers,
    usage,
    meetings,
    taskPlans,
    eventsByRunId,
    selectedEmployeeId,
    selectEmployee,
    setActiveView,
    saveFloorplanLayout,
  } = useOfficeStore();

  const floorplan = company?.floorplan;
  const activeMeeting = meetings.find((m) => m.status === "RUNNING") ?? null;
  const activeCount = runs.filter(
    (r) => r.status === "RUNNING" || r.status === "PLANNING" || r.status === "QUEUED",
  ).length;
  const pendingCount = approvals.filter((a) => a.status === "PENDING").length;
  const liveSpend = usage?.liveTodayUsd ?? 0;
  const readyProviders = providers.filter((p) => p.available && p.provider !== "mock").length;
  const totalRealProviders = providers.filter((p) => p.provider !== "mock").length;
  const employeeById = new Map(employees.map((e) => [e.profile.id, e]));

  // --- Layout Builder + Undo/Redo state ---
  const [editMode, setEditMode] = useState(false);
  const [draftTheme, setDraftTheme] = useState<FloorplanTheme>("sunlit_studio");
  const [draftWidth, setDraftWidth] = useState(1200);
  const [draftHeight, setDraftHeight] = useState(760);
  const [draftDepartments, setDraftDepartments] = useState<Department[]>([]);
  const [draftZones, setDraftZones] = useState<FloorplanZone[]>([]);
  const [draftDesks, setDraftDesks] = useState<FloorplanDesk[]>([]);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [draggingDeskId, setDraggingDeskId] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutBanner, setLayoutBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const [history, setHistory] = useState<LayoutSnapshot[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const [showAddZone, setShowAddZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState("Focus Studio");
  const [newZoneNameAr, setNewZoneNameAr] = useState("غرفة تركيز");
  const [newZoneKind, setNewZoneKind] = useState<FloorplanZone["kind"]>("workstations");

  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("Security & QA");
  const [newDeptNameAr, setNewDeptNameAr] = useState("الأمن والجودة");
  const [newDeptColor, setNewDeptColor] = useState("#7C3AED");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragMovedRef = useRef(false);

  const currentDraftSnapshot = useCallback(
    (): LayoutSnapshot => ({
      theme: draftTheme,
      width: draftWidth,
      height: draftHeight,
      departments: draftDepartments,
      zones: draftZones,
      desks: draftDesks,
    }),
    [draftTheme, draftWidth, draftHeight, draftDepartments, draftZones, draftDesks],
  );

  const commitHistorySnapshot = useCallback(
    (snap: LayoutSnapshot) => {
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIdx + 1);
        const next = [...sliced, cloneSnapshot(snap)].slice(-30);
        setHistoryIdx(next.length - 1);
        return next;
      });
    },
    [historyIdx],
  );

  const applySnapshot = useCallback((snap: LayoutSnapshot) => {
    const cloned = cloneSnapshot(snap);
    setDraftTheme(cloned.theme);
    setDraftWidth(cloned.width);
    setDraftHeight(cloned.height);
    setDraftDepartments(cloned.departments);
    setDraftZones(cloned.zones);
    setDraftDesks(cloned.desks);
  }, []);

  const canUndo = editMode && historyIdx > 0;
  const canRedo = editMode && historyIdx >= 0 && historyIdx < history.length - 1;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const targetIdx = historyIdx - 1;
    const snap = history[targetIdx];
    if (!snap) return;
    applySnapshot(snap);
    setHistoryIdx(targetIdx);
  }, [canUndo, historyIdx, history, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const targetIdx = historyIdx + 1;
    const snap = history[targetIdx];
    if (!snap) return;
    applySnapshot(snap);
    setHistoryIdx(targetIdx);
  }, [canRedo, historyIdx, history, applySnapshot]);

  useEffect(() => {
    if (!editMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editMode, handleUndo, handleRedo]);

  useEffect(() => {
    if (!editMode && company && floorplan) {
      setDraftTheme(floorplan.theme ?? "sunlit_studio");
      setDraftWidth(floorplan.width);
      setDraftHeight(floorplan.height);
      setDraftDepartments(company.departments);
      setDraftZones(floorplan.zones);
      setDraftDesks(floorplan.desks);
    }
  }, [editMode, company, floorplan]);

  const enterEditMode = () => {
    if (!company || !floorplan) return;
    const initial: LayoutSnapshot = cloneSnapshot({
      theme: floorplan.theme ?? "sunlit_studio",
      width: floorplan.width,
      height: floorplan.height,
      departments: company.departments,
      zones: floorplan.zones,
      desks: floorplan.desks,
    });
    applySnapshot(initial);
    setHistory([initial]);
    setHistoryIdx(0);
    setSelectedZoneId(null);
    setSelectedDeskId(null);
    setShowAddZone(false);
    setShowAddDept(false);
    setLayoutBanner(null);
    setEditMode(true);
  };

  const activeThemeKey: FloorplanTheme = editMode
    ? draftTheme
    : floorplan?.theme ?? "sunlit_studio";
  const palette: ThemePalette =
    uiTheme === "dark" && activeThemeKey === "sunlit_studio"
      ? DARK_STUDIO_PALETTE
      : LIGHT_PALETTES[activeThemeKey] ?? LIGHT_PALETTES.sunlit_studio;

  const activeWidth = editMode ? draftWidth : floorplan?.width ?? 1200;
  const activeHeight = editMode ? draftHeight : floorplan?.height ?? 760;
  const activeZones = editMode ? draftZones : floorplan?.zones ?? [];
  const activeDesks = editMode ? draftDesks : floorplan?.desks ?? [];
  const activeDepartments = editMode ? draftDepartments : company?.departments ?? [];

  const deptColorMap = useMemo(() => {
    const map: Record<string, string> = { ...DEFAULT_DEPT_COLORS };
    for (const d of activeDepartments) {
      map[d.id] = d.color;
    }
    return map;
  }, [activeDepartments]);

  const collidingDeskIds = useMemo(() => {
    const bad = new Set<string>();
    const list = editMode ? draftDesks : [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (Math.abs(a.x - b.x) < 180 && Math.abs(a.y - b.y) < 100) {
          bad.add(a.id);
          bad.add(b.id);
        }
      }
    }
    return bad;
  }, [editMode, draftDesks]);

  // Active DAG Handoff Arcs between desks whose employees collaborate in running TaskPlan
  const dagHandoffArcs = useMemo(() => {
    if (editMode) return [];
    const runningPlans = taskPlans.filter((p) => p.status === "RUNNING");
    if (runningPlans.length === 0) return [];
    const deskByEmp = new Map<string, FloorplanDesk>();
    for (const desk of activeDesks) {
      if (desk.employeeId) deskByEmp.set(desk.employeeId, desk);
    }
    const arcs: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
    const seenArcIds = new Set<string>();
    for (const plan of runningPlans) {
      const nodeByKeyOrId = new Map<string, (typeof plan.nodes)[number]>();
      for (const n of plan.nodes) {
        nodeByKeyOrId.set(n.id, n);
        nodeByKeyOrId.set(n.nodeKey, n);
      }
      for (const node of plan.nodes) {
        const targetDesk = deskByEmp.get(node.assignedEmployeeId);
        if (!targetDesk) continue;
        for (const depKeyOrId of node.dependsOn) {
          const upstream = nodeByKeyOrId.get(depKeyOrId);
          const sourceDesk = upstream ? deskByEmp.get(upstream.assignedEmployeeId) : undefined;
          if (sourceDesk && sourceDesk.id !== targetDesk.id) {
            const arcId = `${plan.id}:${sourceDesk.id}->${targetDesk.id}`;
            if (seenArcIds.has(arcId)) continue;
            seenArcIds.add(arcId);
            arcs.push({
              id: arcId,
              x1: sourceDesk.x + 96,
              y1: sourceDesk.y + 52,
              x2: targetDesk.x + 96,
              y2: targetDesk.y + 52,
            });
          }
        }
      }
    }
    return arcs;
  }, [editMode, taskPlans, activeDesks]);

  const screenToSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const handleDeskPointerDown = (
    e: React.PointerEvent<SVGGElement>,
    desk: FloorplanDesk,
  ) => {
    if (!editMode) return;
    e.stopPropagation();
    setSelectedDeskId(desk.id);
    setSelectedZoneId(null);
    const pt = screenToSvg(e.clientX, e.clientY);
    if (!pt) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Automated synthetic events may omit capture
    }
    dragOffsetRef.current = { dx: pt.x - desk.x, dy: pt.y - desk.y };
    dragMovedRef.current = false;
    setDraggingDeskId(desk.id);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editMode || !draggingDeskId) return;
    const pt = screenToSvg(e.clientX, e.clientY);
    if (!pt) return;
    const snappedX = snapCoord(pt.x - dragOffsetRef.current.dx, snapToGrid);
    const snappedY = snapCoord(pt.y - dragOffsetRef.current.dy, snapToGrid);
    const clampedX = Math.max(30, Math.min(draftWidth - 220, snappedX));
    const clampedY = Math.max(30, Math.min(draftHeight - 120, snappedY));

    setDraftDesks((prev) =>
      prev.map((d) => {
        if (d.id !== draggingDeskId) return d;
        if (d.x !== clampedX || d.y !== clampedY) {
          dragMovedRef.current = true;
        }
        const centerX = clampedX + 90;
        const centerY = clampedY + 50;
        const matchingZone = draftZones.find(
          (z) =>
            centerX >= z.x &&
            centerX <= z.x + z.width &&
            centerY >= z.y &&
            centerY <= z.y + z.height,
        );
        return {
          ...d,
          x: clampedX,
          y: clampedY,
          zoneId: matchingZone?.id ?? d.zoneId,
        };
      }),
    );
  };

  const stopDragging = () => {
    if (draggingDeskId && dragMovedRef.current) {
      commitHistorySnapshot(currentDraftSnapshot());
    }
    dragMovedRef.current = false;
    setDraggingDeskId(null);
  };

  const handleRotateDesk = (deskId: string) => {
    const nextDesks = draftDesks.map((d) => {
      if (d.id !== deskId) return d;
      const cur = d.rotationDeg ?? 0;
      const nextRot = (((cur + 90) % 360) as DeskRotation);
      return { ...d, rotationDeg: nextRot };
    });
    setDraftDesks(nextDesks);
    commitHistorySnapshot({ ...currentDraftSnapshot(), desks: nextDesks });
  };

  const handleAddZone = (e: React.FormEvent) => {
    e.preventDefault();
    const idBase =
      newZoneName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "zone";
    let id = idBase;
    let n = 2;
    while (draftZones.some((z) => z.id === id)) {
      id = `${idBase}-${n}`;
      n += 1;
    }
    const zoneW = 300;
    const zoneH = 200;
    const x = Math.max(40, Math.min(draftWidth - zoneW - 40, 420));
    const y = Math.max(40, Math.min(draftHeight - zoneH - 40, 40));
    const created: FloorplanZone = {
      id,
      name: newZoneName.trim() || "New Zone",
      nameAr: newZoneNameAr.trim() || "منطقة جديدة",
      kind: newZoneKind,
      x,
      y,
      width: zoneW,
      height: zoneH,
    };
    const nextZones = [...draftZones, created];
    setDraftZones(nextZones);
    commitHistorySnapshot({ ...currentDraftSnapshot(), zones: nextZones });
    setSelectedZoneId(created.id);
    setShowAddZone(false);
  };

  const handleAddDepartment = (e: React.FormEvent) => {
    e.preventDefault();
    const idBase =
      newDeptName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "dept";
    let id = idBase;
    let n = 2;
    while (draftDepartments.some((d) => d.id === id)) {
      id = `${idBase}-${n}`;
      n += 1;
    }
    const nextDepts = [
      ...draftDepartments,
      {
        id,
        name: newDeptName.trim() || "Custom Dept",
        nameAr: newDeptNameAr.trim() || "قسم جديد",
        color: newDeptColor,
      },
    ];
    setDraftDepartments(nextDepts);
    commitHistorySnapshot({ ...currentDraftSnapshot(), departments: nextDepts });
    setShowAddDept(false);
  };

  const handleSaveLayout = async () => {
    if (collidingDeskIds.size > 0) return;
    setSavingLayout(true);
    setLayoutBanner(null);
    try {
      await saveFloorplanLayout({
        width: draftWidth,
        height: draftHeight,
        theme: draftTheme,
        departments: draftDepartments,
        zones: draftZones,
        desks: draftDesks,
      });
      setEditMode(false);
      setSelectedZoneId(null);
      setSelectedDeskId(null);
      setLayoutBanner({
        ok: true,
        text:
          locale === "ar"
            ? "تم حفظ مخطط المكتب والثيم في company.json بنجاح."
            : "Saved office floorplan layout & theme to company.json.",
      });
    } catch (err) {
      setLayoutBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to save floorplan layout",
      });
    } finally {
      setSavingLayout(false);
    }
  };

  const selectedZone = draftZones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedDesk = draftDesks.find((d) => d.id === selectedDeskId) ?? null;
  const is3dView = !editMode && (officeViewMode === "3d_orbit" || officeViewMode === "3d_fp");

  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden bg-studio-ground">
      {/* Floating Compact Telemetry Pill + Setup Checklist (Top-Start, non-blocking) */}
      {!editMode && (
        <div className="pointer-events-none absolute top-3.5 start-4 z-20 flex flex-wrap items-center gap-2 max-w-[calc(100%-2rem)]">
          <div className="pointer-events-auto inline-flex items-center rounded-full border border-studio-border-strong bg-studio-surface/90 backdrop-blur-md shadow-float divide-x rtl:divide-x-reverse divide-studio-border text-[11.5px]">
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeCount > 0 ? "bg-studio-emerald" : "bg-studio-faint"
                }`}
              />
              <span className="font-mono font-semibold tabular-nums text-studio-ink">
                {activeCount}
              </span>
              <span className="text-studio-muted">
                {locale === "ar" ? "نشط" : "Active"}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setActiveView("approvals")}
              className="px-3 py-1.5 flex items-center gap-1.5 hover:bg-studio-subtle/60 transition-colors"
            >
              <span
                className={`font-mono font-semibold tabular-nums ${
                  pendingCount > 0 ? "text-studio-amber" : "text-studio-ink"
                }`}
              >
                {pendingCount}
              </span>
              <span className="text-studio-muted">
                {locale === "ar" ? "موافقة" : "Approvals"}
              </span>
            </button>

            <div className="px-3 py-1.5 flex items-center gap-1.5" dir="ltr">
              <span className="font-mono font-semibold tabular-nums text-studio-ink">
                ${liveSpend.toFixed(2)}
              </span>
              <span className="text-studio-faint text-[11px]">
                /{(company?.budgets.defaultDailyBudgetUsd ?? 15).toFixed(0)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setActiveView("providers")}
              className="px-3 py-1.5 flex items-center gap-1.5 hover:bg-studio-subtle/60 transition-colors rounded-e-full"
            >
              <span dir="ltr" className="font-mono font-semibold tabular-nums text-studio-ink">
                {readyProviders}/{totalRealProviders}
              </span>
              <span className="text-studio-muted">
                {locale === "ar" ? "مزود" : "Ready"}
              </span>
            </button>
          </div>

          <div className="pointer-events-auto">
            <OnboardingStrip />
          </div>
        </div>
      )}

      {/* Design Mode Compact Header & Builder Toolbar (only visible when editing floorplan) */}
      {editMode && (
        <div className="shrink-0 z-20 border-b border-studio-border bg-studio-surface">
          <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-semibold text-studio-ink">
                {locale === "ar" ? "وضع تعديل المخطط" : "Studio Layout Design Mode"}
              </span>
              <span className="text-[12px] text-studio-muted hidden sm:inline">
                {locale === "ar"
                  ? "اسحب أي مكتب لتحريكه أو اضغط لتدويره أو لتعديل غرفة"
                  : "Drag desks to move, select a desk to rotate, or click a zone"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={!canUndo}
                onClick={handleUndo}
                title="Undo (Ctrl+Z)"
                className="h-7 px-2.5 rounded-md border border-studio-border bg-studio-ground text-studio-ink text-[12px] inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "تراجع" : "Undo"}</span>
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={handleRedo}
                title="Redo (Ctrl+Y)"
                className="h-7 px-2.5 rounded-md border border-studio-border bg-studio-ground text-studio-ink text-[12px] inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Redo2 className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "إعادة" : "Redo"}</span>
              </button>
              <button
                type="button"
                disabled={savingLayout || collidingDeskIds.size > 0}
                onClick={() => void handleSaveLayout()}
                className="h-7 px-3 rounded-md bg-studio-ink text-studio-ground text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-45"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {savingLayout
                    ? locale === "ar"
                      ? "جارٍ الحفظ…"
                      : "Saving…"
                    : locale === "ar"
                      ? "حفظ المخطط"
                      : "Save Layout"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditMode(false);
                  setSelectedZoneId(null);
                  setSelectedDeskId(null);
                  setLayoutBanner(null);
                }}
                className="h-7 px-3 rounded-md border border-studio-border bg-studio-ground text-studio-muted text-[12px] font-medium inline-flex items-center gap-1 hover:text-studio-ink"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "إلغاء" : "Cancel"}</span>
              </button>
            </div>
          </div>

          <div className="px-4 py-2 border-t border-studio-border bg-studio-ground/60 space-y-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-1.5">
                <span className="text-studio-muted font-medium">
                  {locale === "ar" ? "الثيم:" : "Theme:"}
                </span>
                <select
                  value={draftTheme}
                  onChange={(e) => {
                    const nextTheme = e.target.value as FloorplanTheme;
                    setDraftTheme(nextTheme);
                    commitHistorySnapshot({ ...currentDraftSnapshot(), theme: nextTheme });
                  }}
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface text-[12px]"
                >
                  {(Object.keys(LIGHT_PALETTES) as FloorplanTheme[]).map((key) => (
                    <option key={key} value={key}>
                      {locale === "ar" ? LIGHT_PALETTES[key].labelAr : LIGHT_PALETTES[key].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(e) => setSnapToGrid(e.target.checked)}
                />
                <Grid className="w-3.5 h-3.5 text-studio-muted" />
                <span>{locale === "ar" ? "محاذاة (20px)" : "Snap (20px)"}</span>
              </label>

              <label className="inline-flex items-center gap-1" dir="ltr">
                <span className="text-studio-muted font-mono">W:</span>
                <input
                  type="number"
                  min={900}
                  max={4000}
                  step={40}
                  value={draftWidth}
                  onChange={(e) => setDraftWidth(Number(e.target.value))}
                  className="w-16 px-1.5 py-0.5 rounded border border-studio-border bg-studio-surface font-mono"
                />
              </label>

              <label className="inline-flex items-center gap-1" dir="ltr">
                <span className="text-studio-muted font-mono">H:</span>
                <input
                  type="number"
                  min={600}
                  max={2400}
                  step={40}
                  value={draftHeight}
                  onChange={(e) => setDraftHeight(Number(e.target.value))}
                  className="w-16 px-1.5 py-0.5 rounded border border-studio-border bg-studio-surface font-mono"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setShowAddZone((v) => !v);
                  setShowAddDept(false);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-studio-border bg-studio-surface hover:border-studio-border-strong"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "غرفة" : "Zone"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAddDept((v) => !v);
                  setShowAddZone(false);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-studio-border bg-studio-surface hover:border-studio-border-strong"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{locale === "ar" ? "قسم" : "Dept"}</span>
              </button>

              {selectedDesk && (
                <button
                  type="button"
                  onClick={() => handleRotateDesk(selectedDesk.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-studio-accent/40 bg-studio-accent-soft text-studio-accent font-medium"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>
                    {locale === "ar" ? "تدوير المكتب" : "Rotate Desk"} (
                    <span dir="ltr" className="font-mono">{selectedDesk.rotationDeg ?? 0}°</span>)
                  </span>
                </button>
              )}
            </div>

            {collidingDeskIds.size > 0 && (
              <div className="px-2.5 py-1.5 rounded border border-studio-crimson/40 bg-studio-crimson-soft text-studio-crimson flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  {locale === "ar"
                    ? "يوجد تداخل بين المكاتب المظللة بالأحمر — أعد توزيعها قبل الحفظ."
                    : "Desk overlap detected (highlighted in red) — separate desks before saving."}
                </span>
              </div>
            )}

            {showAddZone && (
              <form onSubmit={handleAddZone} className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  required
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="English Zone Name"
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface"
                />
                <input
                  required
                  value={newZoneNameAr}
                  onChange={(e) => setNewZoneNameAr(e.target.value)}
                  placeholder="الاسم بالعربي"
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface"
                />
                <select
                  value={newZoneKind}
                  onChange={(e) => setNewZoneKind(e.target.value as FloorplanZone["kind"])}
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface"
                >
                  <option value="workstations">workstations</option>
                  <option value="manager_office">manager_office</option>
                  <option value="meeting_room">meeting_room</option>
                  <option value="lounge">lounge</option>
                </select>
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded bg-studio-ink text-studio-ground font-medium"
                >
                  {locale === "ar" ? "إضافة الغرفة" : "Add Zone"}
                </button>
              </form>
            )}

            {showAddDept && (
              <form onSubmit={handleAddDepartment} className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  required
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="English Dept Name"
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface"
                />
                <input
                  required
                  value={newDeptNameAr}
                  onChange={(e) => setNewDeptNameAr(e.target.value)}
                  placeholder="اسم القسم بالعربي"
                  className="px-2 py-1 rounded border border-studio-border bg-studio-surface"
                />
                <input
                  type="color"
                  value={newDeptColor}
                  onChange={(e) => setNewDeptColor(e.target.value)}
                  className="w-8 h-7 rounded border border-studio-border"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded bg-studio-ink text-studio-ground font-medium"
                >
                  {locale === "ar" ? "إضافة القسم" : "Add Dept"}
                </button>
              </form>
            )}

            {selectedZone && (
              <div className="flex flex-wrap items-center gap-2 p-2 rounded border border-studio-border bg-studio-surface">
                <span className="font-mono text-[11px] text-studio-accent">{selectedZone.id}</span>
                <input
                  value={selectedZone.name}
                  onChange={(e) =>
                    setDraftZones((prev) =>
                      prev.map((z) => (z.id === selectedZone.id ? { ...z, name: e.target.value } : z)),
                    )
                  }
                  className="px-2 py-0.5 rounded border border-studio-border bg-studio-blueprint w-36"
                />
                <input
                  value={selectedZone.nameAr}
                  onChange={(e) =>
                    setDraftZones((prev) =>
                      prev.map((z) => (z.id === selectedZone.id ? { ...z, nameAr: e.target.value } : z)),
                    )
                  }
                  className="px-2 py-0.5 rounded border border-studio-border bg-studio-blueprint w-36"
                />
                <label className="inline-flex items-center gap-1" dir="ltr">
                  <span className="font-mono text-studio-muted">X</span>
                  <input
                    type="number"
                    step={20}
                    min={14}
                    value={selectedZone.x}
                    onChange={(e) =>
                      setDraftZones((prev) =>
                        prev.map((z) =>
                          z.id === selectedZone.id ? { ...z, x: Number(e.target.value) } : z,
                        ),
                      )
                    }
                    className="w-16 px-1 py-0.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                  />
                </label>
                <label className="inline-flex items-center gap-1" dir="ltr">
                  <span className="font-mono text-studio-muted">Y</span>
                  <input
                    type="number"
                    step={20}
                    min={14}
                    value={selectedZone.y}
                    onChange={(e) =>
                      setDraftZones((prev) =>
                        prev.map((z) =>
                          z.id === selectedZone.id ? { ...z, y: Number(e.target.value) } : z,
                        ),
                      )
                    }
                    className="w-16 px-1 py-0.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                  />
                </label>
                <label className="inline-flex items-center gap-1" dir="ltr">
                  <span className="font-mono text-studio-muted">W</span>
                  <input
                    type="number"
                    step={20}
                    min={140}
                    value={selectedZone.width}
                    onChange={(e) =>
                      setDraftZones((prev) =>
                        prev.map((z) =>
                          z.id === selectedZone.id ? { ...z, width: Number(e.target.value) } : z,
                        ),
                      )
                    }
                    className="w-16 px-1 py-0.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                  />
                </label>
                <label className="inline-flex items-center gap-1" dir="ltr">
                  <span className="font-mono text-studio-muted">H</span>
                  <input
                    type="number"
                    step={20}
                    min={120}
                    value={selectedZone.height}
                    onChange={(e) =>
                      setDraftZones((prev) =>
                        prev.map((z) =>
                          z.id === selectedZone.id ? { ...z, height: Number(e.target.value) } : z,
                        ),
                      )
                    }
                    className="w-16 px-1 py-0.5 rounded border border-studio-border bg-studio-blueprint font-mono"
                  />
                </label>
                {!draftDesks.some((d) => d.zoneId === selectedZone.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextZones = draftZones.filter((z) => z.id !== selectedZone.id);
                      setDraftZones(nextZones);
                      commitHistorySnapshot({ ...currentDraftSnapshot(), zones: nextZones });
                      setSelectedZoneId(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-studio-crimson-soft text-studio-crimson"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{locale === "ar" ? "حذف الغرفة" : "Delete"}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Layout Notification Banner (Edit / Save status) */}
      {layoutBanner && (
        <div className="absolute top-14 end-4 z-30 max-w-md">
          <div
            className={`px-3.5 py-2 rounded-xl border text-[12px] shadow-float flex items-center justify-between gap-2 ${
              layoutBanner.ok
                ? "border-studio-emerald/40 bg-studio-surface text-studio-emerald"
                : "border-studio-crimson/40 bg-studio-surface text-studio-crimson"
            }`}
          >
            <div className="flex items-center gap-2">
              {layoutBanner.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              )}
              <span dir="auto">{layoutBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setLayoutBanner(null)}
              className="p-0.5 hover:opacity-75"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Full-Bleed Living Canvas (3D Studio or 2D Architectural Blueprint) */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {is3dView && floorplan ? (
          <WebGLErrorBoundary locale={locale} onFallbackTo2D={() => setOfficeViewMode("2d")}>
            <Suspense
              fallback={
                <div className="h-full w-full flex items-center justify-center bg-studio-ground text-studio-muted text-[13px]">
                  {t(locale, "loading3dScene")}
                </div>
              }
            >
              <Studio3DCanvas
                floorplan={floorplan}
                viewMode={officeViewMode}
                onExitTo2D={() => setOfficeViewMode("2d")}
              />
            </Suspense>
          </WebGLErrorBoundary>
        ) : (
        /* Keep SVG coordinates LTR while labels render cleanly in AR/EN */
        <div
          dir="ltr"
          style={{
            backgroundColor: palette.canvasBg,
            backgroundImage: `radial-gradient(${palette.gridDot} 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
          className={`h-full w-full flex items-center justify-center overflow-auto p-4 ${editMode ? "pb-6" : "pb-20"}`}
        >
          {floorplan && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${activeWidth} ${activeHeight}`}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
              className="w-full h-full max-w-[1320px] max-h-full select-none touch-none drop-shadow-sm"
              role="img"
              aria-label="Virtual Office Architectural Floorplan"
            >
              {/* Outer Architectural Wall */}
              <rect
                x="14"
                y="14"
                width={activeWidth - 28}
                height={activeHeight - 28}
                rx="10"
                fill={palette.wallFill}
                fillOpacity="0.68"
                stroke={palette.wallStroke}
                strokeWidth="2"
              />

              {/* Rooms / Zones */}
              {activeZones.map((zone) => {
                const isGlass = zone.kind === "meeting_room" || zone.kind === "manager_office";
                const isZoneSelected = editMode && selectedZoneId === zone.id;
                return (
                  <g
                    key={zone.id}
                    onClick={() => {
                      if (editMode) {
                        setSelectedZoneId(zone.id);
                        setSelectedDeskId(null);
                      }
                    }}
                    className={editMode ? "cursor-pointer" : undefined}
                  >
                    <rect
                      x={zone.x}
                      y={zone.y}
                      width={zone.width}
                      height={zone.height}
                      rx="8"
                      fill={
                        zone.kind === "lounge"
                          ? palette.loungeFill
                          : zone.kind === "meeting_room"
                            ? palette.meetingFill
                            : palette.zoneFill
                      }
                      stroke={
                        isZoneSelected
                          ? "#D4A853"
                          : isGlass
                            ? uiTheme === "dark"
                              ? "#D4A853"
                              : "#B07A1F"
                            : palette.wallStroke
                      }
                      strokeOpacity={isZoneSelected ? "1" : isGlass ? "0.42" : "1"}
                      strokeWidth={isZoneSelected ? "2.2" : isGlass ? "1.35" : "1.2"}
                      strokeDasharray={zone.kind === "meeting_room" ? "6 4" : undefined}
                    />
                    <text
                      x={zone.x + 16}
                      y={zone.y + 24}
                      fill={palette.mutedText}
                      fontSize="12"
                      fontWeight="600"
                    >
                      {locale === "ar" ? zone.nameAr : zone.name}
                    </text>
                  </g>
                );
              })}

              {/* Interactive Bounded Meeting Room Oval Table & Chairs */}
              <g
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!editMode) setActiveView("orchestration");
                }}
                onKeyDown={(e) => {
                  if (!editMode && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setActiveView("orchestration");
                  }
                }}
                className={editMode ? "opacity-75" : "cursor-pointer focus:outline-none"}
              >
                <ellipse
                  cx="210"
                  cy="545"
                  rx="105"
                  ry="56"
                  fill={activeMeeting ? (uiTheme === "dark" ? "#262012" : "#F8F1E3") : palette.furnitureFill}
                  stroke={activeMeeting ? "#D4A853" : palette.wallStroke}
                  strokeWidth={activeMeeting ? "2" : "1.4"}
                />
                <ellipse
                  cx="210"
                  cy="545"
                  rx="76"
                  ry="30"
                  fill="none"
                  stroke={palette.dividerStroke}
                  strokeWidth="1"
                />
                {[
                  [140, 478],
                  [210, 472],
                  [280, 478],
                  [140, 612],
                  [210, 618],
                  [280, 612],
                ].map(([cx, cy], i) => {
                  const participantId = activeMeeting?.participantEmployeeIds[i];
                  const partEmp = participantId ? employeeById.get(participantId) : undefined;
                  return (
                    <g key={i}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={partEmp ? "15" : "11"}
                        fill={partEmp ? "#D4A853" : palette.furnitureFill}
                        fillOpacity={partEmp ? "0.18" : "1"}
                        stroke={partEmp ? "#D4A853" : palette.wallStroke}
                        strokeWidth={partEmp ? "1.8" : "1.2"}
                      />
                      {partEmp && (
                        <text
                          x={cx}
                          y={(cy ?? 0) + 4}
                          textAnchor="middle"
                          fill="#D4A853"
                          fontSize="9.5"
                          fontWeight="700"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {partEmp.profile.avatar}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text
                  x="210"
                  y="543"
                  textAnchor="middle"
                  fill={activeMeeting ? "#D4A853" : palette.mutedText}
                  fontSize="11"
                  fontWeight={activeMeeting ? "700" : "600"}
                >
                  {activeMeeting
                    ? activeMeeting.topic.slice(0, 26)
                    : locale === "ar"
                      ? "غرفة الاجتماعات"
                      : "Meeting Room"}
                </text>
                <text x="210" y="559" textAnchor="middle" fill={palette.mutedText} fontSize="9.5">
                  {activeMeeting
                    ? `Active (${activeMeeting.turns.length}/${activeMeeting.maxRounds * activeMeeting.participantEmployeeIds.length} turns)`
                    : locale === "ar"
                      ? "اضغط لعقد جلسة"
                      : "Click to convene"}
                </text>
              </g>

              {/* Architectural Furniture: Lounge Sofa, Coffee Table & Studio Plants */}
              <g opacity="0.9">
                <rect
                  x="485"
                  y="580"
                  width="220"
                  height="64"
                  rx="10"
                  fill={palette.furnitureFill}
                  stroke={palette.wallStroke}
                  strokeWidth="1.3"
                />
                <rect x="495" y="588" width="200" height="16" rx="4" fill={palette.dividerStroke} />
                <rect
                  x="765"
                  y="592"
                  width="120"
                  height="52"
                  rx="8"
                  fill={palette.deskFill}
                  stroke={palette.wallStroke}
                  strokeWidth="1.2"
                />
                <circle cx="825" cy="618" r="14" fill={palette.furnitureFill} stroke={palette.dividerStroke} />
                {[
                  [456, activeHeight - 82],
                  [activeWidth - 80, activeHeight - 82],
                  [activeWidth - 80, 80],
                  [350, 75],
                ].map(([px, py], idx) => (
                  <g key={idx}>
                    <circle cx={px} cy={py} r="15" fill="#16B88B" fillOpacity="0.16" stroke="#16B88B" strokeOpacity="0.4" />
                    <circle cx={px} cy={py} r="7" fill="#16B88B" fillOpacity="0.5" />
                  </g>
                ))}
              </g>

              {/* DAG Handoff Arcs when a Multi-Specialist Plan is RUNNING */}
              {dagHandoffArcs.map((arc) => {
                const mx = (arc.x1 + arc.x2) / 2;
                const my = Math.min(arc.y1, arc.y2) - 42;
                return (
                  <path
                    key={arc.id}
                    d={`M ${arc.x1} ${arc.y1} Q ${mx} ${my} ${arc.x2} ${arc.y2}`}
                    fill="none"
                    stroke="#D4A853"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    opacity="0.7"
                  />
                );
              })}

              {/* Employee Workstations & Live Status */}
              {activeDesks.map((desk) => {
                const emp = desk.employeeId ? employeeById.get(desk.employeeId) : undefined;
                if (!emp) {
                  return null;
                }
                const live = selectEmployeeLiveState({ runs, approvals }, emp.profile.id);
                const isSelected = !editMode && selectedEmployeeId === emp.profile.id;
                const isEditSelected = editMode && selectedDeskId === desk.id;
                const isColliding = editMode && collidingDeskIds.has(desk.id);
                const isBeingDragged = editMode && draggingDeskId === desk.id;
                const deptColor = deptColorMap[emp.profile.department] ?? "#D4A853";

                const statusColor =
                  live.status === "working" || live.status === "queued"
                    ? "#16B88B"
                    : live.status === "waiting_approval"
                      ? "#F59E0B"
                      : live.status === "failed"
                        ? "#F05252"
                        : "#94A3B8";

                const statusLabel =
                  live.status === "working"
                    ? t(locale, "statusWorking")
                    : live.status === "queued"
                      ? t(locale, "statusQueued")
                      : live.status === "waiting_approval"
                        ? t(locale, "statusWaitingApproval")
                        : live.status === "failed"
                          ? t(locale, "statusFailed")
                          : t(locale, "statusIdle");

                const isLiveToolActive =
                  live.status === "working" || live.status === "waiting_approval";
                const runEvents =
                  isLiveToolActive && live.activeRun
                    ? (eventsByRunId[live.activeRun.id] ?? [])
                    : [];
                let activeToolPill: string | null = null;
                for (let i = runEvents.length - 1; i >= 0; i -= 1) {
                  const ev = runEvents[i]?.event;
                  if (ev?.type === "tool_call") {
                    activeToolPill = ev.toolName;
                    break;
                  }
                }

                const cardX = desk.x - 24;
                const cardY = desk.y - 10;
                const cardW = 240;
                const cardH = 122;
                const rot = desk.rotationDeg ?? 0;
                const fullRole = locale === "ar" ? emp.profile.roleAr : emp.profile.role;
                const shortRole = fullRole.length > 23 ? `${fullRole.slice(0, 22)}…` : fullRole;

                return (
                  <g
                    key={desk.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${emp.profile.nameAr} - ${emp.profile.name}`}
                    onPointerDown={(e) => handleDeskPointerDown(e, desk)}
                    onClick={() => {
                      if (!editMode) {
                        void selectEmployee(emp.profile.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (!editMode && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        void selectEmployee(emp.profile.id);
                      }
                    }}
                    className={`${editMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} focus:outline-none`}
                  >
                    <title>
                      {editMode
                        ? `${emp.profile.name} (${desk.x}, ${desk.y}) · ${rot}°`
                        : `${locale === "ar" ? emp.profile.nameAr : emp.profile.name} — ${fullRole}`}
                    </title>
                    <rect
                      x={cardX}
                      y={cardY}
                      width={cardW}
                      height={cardH}
                      rx="10"
                      fill={palette.deskFill}
                      stroke={
                        isColliding
                          ? "#F87171"
                          : isBeingDragged || isEditSelected || isSelected
                            ? "#D4A853"
                            : live.status === "waiting_approval"
                              ? "#F59E0B"
                              : palette.deskStroke
                      }
                      strokeWidth={
                        isColliding || isBeingDragged || isEditSelected || isSelected
                          ? "2.5"
                          : live.status === "waiting_approval"
                            ? "2"
                            : "1.4"
                      }
                      strokeDasharray={editMode ? "4 2" : undefined}
                    />

                    {/* Dual monitor orientation indicator reflecting rotationDeg */}
                    {rot === 90 || rot === 270 ? (
                      <g>
                        <rect
                          x={rot === 90 ? cardX + cardW - 12 : cardX + 6}
                          y={cardY + 26}
                          width="6"
                          height="32"
                          rx="2"
                          fill={palette.dividerStroke}
                        />
                        <rect
                          x={rot === 90 ? cardX + cardW - 12 : cardX + 6}
                          y={cardY + 64}
                          width="6"
                          height="32"
                          rx="2"
                          fill={palette.dividerStroke}
                        />
                      </g>
                    ) : (
                      <g>
                        <rect
                          x={cardX + 54}
                          y={rot === 180 ? cardY + cardH - 14 : cardY + 8}
                          width="48"
                          height="6"
                          rx="2"
                          fill={palette.dividerStroke}
                        />
                        <rect
                          x={cardX + 108}
                          y={rot === 180 ? cardY + cardH - 14 : cardY + 8}
                          width="48"
                          height="6"
                          rx="2"
                          fill={palette.dividerStroke}
                        />
                      </g>
                    )}

                    {(live.status === "working" ||
                      live.status === "queued" ||
                      live.status === "waiting_approval") && (
                      <circle
                        cx={cardX + 34}
                        cy={cardY + 46}
                        r="21"
                        fill="none"
                        stroke={statusColor}
                        strokeWidth="2"
                        className="animate-status-ring"
                      />
                    )}

                    <circle
                      cx={cardX + 34}
                      cy={cardY + 46}
                      r="17"
                      fill={deptColor}
                      fillOpacity="0.16"
                      stroke={deptColor}
                      strokeWidth="1.5"
                    />
                    <text
                      x={cardX + 34}
                      y={cardY + 51}
                      textAnchor="middle"
                      fill={deptColor}
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {emp.profile.avatar}
                    </text>

                    <text x={cardX + 60} y={cardY + 42} fill={palette.inkText} fontSize="13.5" fontWeight="700">
                      {locale === "ar" ? emp.profile.nameAr : emp.profile.name}
                    </text>
                    <text x={cardX + 60} y={cardY + 59} fill={palette.mutedText} fontSize="10.5">
                      {shortRole}
                    </text>

                    <line
                      x1={cardX + 14}
                      y1={cardY + 78}
                      x2={cardX + cardW - 14}
                      y2={cardY + 78}
                      stroke={palette.dividerStroke}
                      strokeWidth="1"
                    />

                    <circle cx={cardX + 22} cy={cardY + 99} r="4" fill={statusColor} />
                    <text x={cardX + 32} y={cardY + 103} fill={statusColor} fontSize="11" fontWeight="600">
                      {editMode ? `${desk.x}, ${desk.y} · ${rot}°` : statusLabel}
                    </text>

                    <rect
                      x={cardX + cardW - 64}
                      y={cardY + 89}
                      width="50"
                      height="20"
                      rx="4"
                      fill={palette.canvasBg}
                      stroke={palette.dividerStroke}
                    />
                    <text
                      x={cardX + cardW - 39}
                      y={cardY + 102}
                      textAnchor="middle"
                      fill={palette.mutedText}
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {emp.profile.runtime.provider.toUpperCase()}
                    </text>

                    {/* Live Tool Pill when employee is actively running */}
                    {!editMode && activeToolPill && (
                      <g>
                        <rect
                          x={cardX + 14}
                          y={cardY - 12}
                          width="120"
                          height="18"
                          rx="9"
                          fill="#16B88B"
                        />
                        <text
                          x={cardX + 74}
                          y={cardY}
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="9.5"
                          fontWeight="600"
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {activeToolPill.slice(0, 16)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        )}
      </div>

      {/* Floating Bottom Command Dock: 4-Way Switcher + Team Quick Avatars + Talk to GM */}
      {!editMode && (
        <div className="pointer-events-none absolute bottom-4 inset-x-4 z-20 flex justify-center">
          <div className="pointer-events-auto inline-flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-studio-border-strong bg-studio-surface/92 backdrop-blur-md px-2.5 py-1.5 shadow-float max-w-full">
            <div
              role="group"
              aria-label="Office View Mode"
              className="inline-flex items-center rounded-xl bg-studio-ground p-0.5 text-[11.5px]"
            >
              <button
                type="button"
                onClick={() => setOfficeViewMode("2d")}
                className={`h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                  officeViewMode === "2d"
                    ? "bg-studio-subtle text-studio-ink font-medium"
                    : "text-studio-muted hover:text-studio-ink"
                }`}
              >
                <MapIcon className="w-3.5 h-3.5 text-studio-accent" />
                <span>{t(locale, "viewMode2d")}</span>
              </button>
              <button
                type="button"
                onClick={() => setOfficeViewMode("3d_orbit")}
                className={`h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                  officeViewMode === "3d_orbit"
                    ? "bg-studio-subtle text-studio-ink font-medium"
                    : "text-studio-muted hover:text-studio-ink"
                }`}
              >
                <Box className="w-3.5 h-3.5 text-studio-accent" />
                <span>{t(locale, "viewMode3dOrbit")}</span>
              </button>
              <button
                type="button"
                onClick={() => setOfficeViewMode("3d_fp")}
                className={`h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                  officeViewMode === "3d_fp"
                    ? "bg-studio-subtle text-studio-ink font-medium"
                    : "text-studio-muted hover:text-studio-ink"
                }`}
              >
                <Compass className="w-3.5 h-3.5 text-studio-accent" />
                <span>{t(locale, "viewMode3dFp")}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={enterEditMode}
              className="h-7 px-2.5 rounded-lg border border-studio-border bg-studio-ground text-studio-muted hover:text-studio-ink text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              <span>{locale === "ar" ? "تعديل المخطط" : "Edit Layout"}</span>
            </button>

            <div className="h-5 w-px bg-studio-border hidden sm:block" />

            {/* Quick Team Avatar Strip */}
            <div className="hidden md:flex items-center gap-1">
              {employees.slice(0, 6).map((emp) => {
                const live = selectEmployeeLiveState({ runs, approvals }, emp.profile.id);
                const selected = selectedEmployeeId === emp.profile.id;
                const dotColor =
                  live.status === "working" || live.status === "queued"
                    ? "bg-studio-emerald"
                    : live.status === "waiting_approval"
                      ? "bg-studio-amber"
                      : live.status === "failed"
                        ? "bg-studio-crimson"
                        : "bg-studio-faint";
                return (
                  <button
                    key={emp.profile.id}
                    type="button"
                    onClick={() => void selectEmployee(emp.profile.id)}
                    title={locale === "ar" ? `${emp.profile.nameAr} — ${emp.profile.roleAr}` : `${emp.profile.name} — ${emp.profile.role}`}
                    className={`h-7 px-2 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                      selected
                        ? "bg-studio-subtle text-studio-ink border border-studio-accent/50"
                        : "text-studio-muted hover:text-studio-ink hover:bg-studio-ground"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    <span>{locale === "ar" ? emp.profile.nameAr : emp.profile.name}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void selectEmployee("general-manager")}
              className="h-7 px-3 rounded-lg bg-studio-ink text-studio-ground text-[11.5px] font-medium hover:opacity-90 transition-opacity"
            >
              {locale === "ar" ? "التحدث مع المدير العام (رامي)" : "Talk to GM (Rami)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
