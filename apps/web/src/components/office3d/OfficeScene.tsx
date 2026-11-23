import { ContactShadows } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type MutableRefObject } from "react";
import type {
  LoadedEmployee,
  MeetingRecord,
  OfficeFloorplan,
  TaskPlan,
} from "@virtual-office/shared";
import type { Locale } from "../../i18n/translations.ts";
import type {
  AvatarRendererMode3D,
  EmployeeLiveStatus,
  QualityTier3D,
} from "../../store/office-store.ts";
import { ArchitecturalRoom } from "./ArchitecturalRoom.tsx";
import { CameraRig, type CameraPresetTarget } from "./CameraRig.tsx";
import { DagHandoffArcs } from "./DagHandoffArcs.tsx";
import { DynamicFurniture } from "./DynamicFurniture.tsx";
import {
  FirstPersonController,
  type ProximityPromptTarget,
} from "./FirstPersonController.tsx";
import { ProceduralAvatar } from "./adapters/ProceduralAvatar.tsx";
import { RiggedGlbAvatar } from "./adapters/RiggedGlbAvatar.tsx";
import {
  stepBehaviorSystem,
  type AmbientLifeMode,
  type AvatarAgentState,
  type EmployeeBehaviorInput,
} from "./behavior-controller.ts";
import type { OfficeNavGrid } from "./navgrid.ts";

interface OfficeSceneProps {
  floorplan: OfficeFloorplan;
  navGrid: OfficeNavGrid;
  employees: LoadedEmployee[];
  deptColorMap: Record<string, string>;
  meetings: MeetingRecord[];
  taskPlans: TaskPlan[];
  agentsMapRef: MutableRefObject<Record<string, AvatarAgentState>>;
  behaviorInputs: EmployeeBehaviorInput[];
  statusByEmployeeId: Record<string, EmployeeLiveStatus | "meeting">;
  activeToolByEmployeeId: Record<string, string | null>;
  viewMode: "3d_orbit" | "3d_fp";
  lightingMode: "day" | "night";
  qualityTier: QualityTier3D;
  ambientMode: AmbientLifeMode;
  avatarRendererMode: AvatarRendererMode3D;
  reducedMotion: boolean;
  locale: Locale;
  selectedEmployeeId: string | null;
  hoveredEmployeeId: string | null;
  cameraPreset: CameraPresetTarget;
  onSelectEmployee: (employeeId: string) => void;
  onHoverChange: (employeeId: string | null) => void;
  onOpenMeetingView: () => void;
  onProximityChange: (target: ProximityPromptTarget | null) => void;
  onActivateProximity: (target: ProximityPromptTarget) => void;
}

export function OfficeScene({
  floorplan,
  navGrid,
  employees,
  deptColorMap,
  meetings,
  taskPlans,
  agentsMapRef,
  behaviorInputs,
  statusByEmployeeId,
  activeToolByEmployeeId,
  viewMode,
  lightingMode,
  qualityTier,
  ambientMode,
  avatarRendererMode,
  reducedMotion,
  locale,
  selectedEmployeeId,
  hoveredEmployeeId,
  cameraPreset,
  onSelectEmployee,
  onHoverChange,
  onOpenMeetingView,
  onProximityChange,
  onActivateProximity,
}: OfficeSceneProps) {
  useFrame((_state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    stepBehaviorSystem(agentsMapRef.current, behaviorInputs, navGrid, floorplan, dt, {
      ambientMode,
      reducedMotion,
      meetings,
    });
  });

  const isDay = lightingMode === "day";
  const shadowSize = qualityTier === "high" ? 1024 : 512;
  const sceneBg = isDay ? "#EAE5DC" : "#09090B";

  return (
    <>
      <color attach="background" args={[sceneBg]} />
      <fog attach="fog" args={[sceneBg, 22, 46]} />

      <hemisphereLight
        color={isDay ? "#FFFDF9" : "#E4E4E7"}
        groundColor={isDay ? "#D6CEC0" : "#27272A"}
        intensity={isDay ? 0.92 : 0.56}
      />

      <directionalLight
        position={[7.5, 13, 7]}
        intensity={isDay ? 1.4 : 0.88}
        color={isDay ? "#FFF5E4" : "#F4EDE2"}
        castShadow={qualityTier !== "eco"}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-camera-near={1}
        shadow-camera-far={34}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0005}
      />

      {/* Warm Architectural Pendant & Studio Zone Fill Lights (Obsidian Evening) */}
      {!isDay && (
        <>
          <pointLight position={[-3.8, 2.2, 1.6]} intensity={2.6} distance={9} color="#FCD34D" />
          <pointLight position={[-3.6, 2.5, -1.8]} intensity={2.4} distance={8} color="#FDE68A" />
          <pointLight position={[1.8, 3.1, -0.4]} intensity={3.8} distance={15} color="#FFEBD0" />
          <pointLight position={[2.6, 2.2, 2.2]} intensity={2.3} distance={9.5} color="#FCD34D" />
          <pointLight position={[-0.8, 2.3, 3.1]} intensity={2.0} distance={8.5} color="#F59E0B" />
        </>
      )}

      {qualityTier !== "eco" && (
        <ContactShadows
          position={[0, 0.004, 0]}
          opacity={isDay ? 0.34 : 0.55}
          scale={18}
          blur={2.1}
          far={4}
          frames={1}
          resolution={qualityTier === "high" ? 512 : 256}
          color="#000000"
        />
      )}

      <ArchitecturalRoom
        floorplan={floorplan}
        partitionSegments={navGrid.partitionSegments}
        lightingMode={lightingMode}
      />

      <DynamicFurniture
        floorplan={floorplan}
        statusByEmployeeId={statusByEmployeeId}
        lightingMode={lightingMode}
        onSelectEmployee={onSelectEmployee}
        onOpenMeetingView={onOpenMeetingView}
      />

      <DagHandoffArcs
        taskPlans={taskPlans}
        floorplan={floorplan}
        reducedMotion={reducedMotion}
      />

      {employees.map((emp) => {
        const useRiggedGlb =
          avatarRendererMode === "rigged_all" ||
          (avatarRendererMode === "hybrid" &&
            (Boolean(emp.profile.avatarModelUrl) || emp.profile.id === "general-manager"));

        const commonProps = {
          employee: emp,
          deptColor: deptColorMap[emp.profile.department] ?? "#D4A853",
          agentsMapRef,
          operationalMode: statusByEmployeeId[emp.profile.id] ?? "idle",
          activeToolName: activeToolByEmployeeId[emp.profile.id] ?? null,
          selected: selectedEmployeeId === emp.profile.id,
          hovered: hoveredEmployeeId === emp.profile.id,
          reducedMotion,
          locale,
          modelUrl: emp.profile.avatarModelUrl ?? "/assets/avatars/sample-rigged.glb",
          onSelect: onSelectEmployee,
          onHoverChange,
        };

        return useRiggedGlb ? (
          <RiggedGlbAvatar key={`${emp.profile.id}:glb`} {...commonProps} />
        ) : (
          <ProceduralAvatar key={`${emp.profile.id}:proc`} {...commonProps} />
        );
      })}

      {viewMode === "3d_orbit" ? (
        <CameraRig preset={cameraPreset} reducedMotion={reducedMotion} />
      ) : (
        <FirstPersonController
          navGrid={navGrid}
          floorplan={floorplan}
          employees={employees}
          agentsMapRef={agentsMapRef}
          locale={locale}
          onProximityChange={onProximityChange}
          onActivateTarget={onActivateProximity}
        />
      )}
    </>
  );
}
