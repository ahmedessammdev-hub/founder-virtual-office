import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OfficeFloorplan } from "@virtual-office/shared";
import type { EmployeeLiveStatus } from "../../store/office-store.ts";
import {
  PX_PER_METER,
  getDeskPoseWorld,
  getMeetingSeatsWorld,
  getMeetingTableWorld,
} from "./coordinates.ts";

interface DynamicFurnitureProps {
  floorplan: OfficeFloorplan;
  statusByEmployeeId: Record<string, EmployeeLiveStatus | "meeting">;
  lightingMode: "day" | "night";
  onSelectEmployee: (employeeId: string) => void;
  onOpenMeetingView: () => void;
}

function createMonitorCodeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0B0C10";
  ctx.fillRect(0, 0, 256, 160);

  // Subtle top bar & sidebar inside monitor
  ctx.fillStyle = "#18181F";
  ctx.fillRect(0, 0, 256, 18);
  ctx.fillRect(0, 18, 42, 142);

  // Clean stylized code/UI lines
  const lines = [
    { x: 54, y: 32, w: 96, c: "#D4A853" },
    { x: 64, y: 46, w: 144, c: "#34D399" },
    { x: 64, y: 60, w: 110, c: "#71717A" },
    { x: 74, y: 74, w: 132, c: "#A1A1AA" },
    { x: 54, y: 92, w: 80, c: "#D4A853" },
    { x: 64, y: 106, w: 152, c: "#38BDF8" },
    { x: 64, y: 120, w: 120, c: "#71717A" },
    { x: 54, y: 136, w: 92, c: "#34D399" },
  ];
  for (const line of lines) {
    ctx.fillStyle = line.c;
    ctx.fillRect(line.x, line.y, line.w, 6);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function DynamicFurniture({
  floorplan,
  statusByEmployeeId,
  lightingMode,
  onSelectEmployee,
  onOpenMeetingView,
}: DynamicFurnitureProps) {
  const deskPoses = useMemo(
    () => floorplan.desks.map((d) => getDeskPoseWorld(d, floorplan)),
    [floorplan],
  );
  const meetingTable = useMemo(() => getMeetingTableWorld(floorplan), [floorplan]);
  const meetingSeats = useMemo(() => getMeetingSeatsWorld(floorplan), [floorplan]);
  const loungeZone = floorplan.zones.find((z) => z.kind === "lounge");

  const monitorTexture = useMemo(() => createMonitorCodeTexture(), []);
  useEffect(() => {
    return () => {
      monitorTexture?.dispose();
    };
  }, [monitorTexture]);

  // Instanced desk legs (4 legs per desk -> single draw call regardless of team size)
  const legCount = deskPoses.length * 4;
  const legMeshRef = useRef<THREE.InstancedMesh>(null);
  const legGeo = useMemo(() => new THREE.CylinderGeometry(0.024, 0.020, 0.72, 10), []);
  const legMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#27272D", roughness: 0.35, metalness: 0.7 }),
    [],
  );

  useEffect(() => {
    const mesh = legMeshRef.current;
    if (!mesh || legCount === 0) return;
    const dummy = new THREE.Object3D();
    let idx = 0;
    const offsets: Array<[number, number]> = [
      [-0.68, -0.32],
      [0.68, -0.32],
      [-0.68, 0.32],
      [0.68, 0.32],
    ];
    for (const pose of deskPoses) {
      const cos = Math.cos(pose.yaw);
      const sin = Math.sin(pose.yaw);
      for (const [lx, lz] of offsets) {
        const wx = pose.center.x + lx * cos + lz * sin;
        const wz = pose.center.z - lx * sin + lz * cos;
        dummy.position.set(wx, 0.36, wz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [deskPoses, legCount]);

  useEffect(() => {
    return () => {
      legGeo.dispose();
      legMat.dispose();
    };
  }, [legGeo, legMat]);

  const woodColor = lightingMode === "night" ? "#5A4432" : "#DABFA0";
  const chairFabric = lightingMode === "night" ? "#1E1E24" : "#334155";
  const loungeBox = useMemo(() => {
    if (!loungeZone) return null;
    const halfW = floorplan.width / (2 * PX_PER_METER);
    const halfH = floorplan.height / (2 * PX_PER_METER);
    const xMin = loungeZone.x / PX_PER_METER - halfW;
    const zMin = loungeZone.y / PX_PER_METER - halfH;
    const w = loungeZone.width / PX_PER_METER;
    const h = loungeZone.height / PX_PER_METER;
    return {
      sofaCenter: [xMin + w * 0.29, 0, zMin + h * 0.75] as [number, number, number],
      coffeeTableCenter: [xMin + w * 0.29, 0, zMin + h * 0.42] as [number, number, number],
      coffeeBarCenter: [xMin + w * 0.78, 0, zMin + h * 0.25] as [number, number, number],
    };
  }, [loungeZone, floorplan.width, floorplan.height]);

  return (
    <group>
      {legCount > 0 && (
        <instancedMesh
          ref={legMeshRef}
          args={[legGeo, legMat, legCount]}
          castShadow
          receiveShadow
        />
      )}

      {/* Desks, Code-Textured Dual Studio Monitors, Brass Desk Lamps & Chairs */}
      {deskPoses.map((pose) => {
        const opStatus = pose.employeeId ? statusByEmployeeId[pose.employeeId] ?? "idle" : "idle";
        const screenEmissive =
          opStatus === "working" || opStatus === "queued"
            ? "#34D399"
            : opStatus === "waiting_approval"
              ? "#F59E0B"
              : opStatus === "failed"
                ? "#F87171"
                : "#D4A853";
        const screenIntensity =
          opStatus === "working" ? 1.05 : opStatus === "waiting_approval" ? 0.95 : 0.48;

        return (
          <group key={pose.deskId}>
            <group
              position={[pose.center.x, 0, pose.center.z]}
              rotation={[0, pose.yaw, 0]}
              onClick={(e) => {
                if (pose.employeeId) {
                  e.stopPropagation();
                  onSelectEmployee(pose.employeeId);
                }
              }}
            >
              {/* Sculpted Chamfered Tabletop */}
              <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
                <boxGeometry args={[1.54, 0.048, 0.78]} />
                <meshStandardMaterial color={woodColor} roughness={0.5} />
              </mesh>
              {/* Dual Studio Monitors with IDE Texture */}
              {[-0.27, 0.27].map((mx, mIdx) => (
                <group
                  key={mIdx}
                  position={[mx, 0.99, 0.18]}
                  rotation={[0, mIdx === 0 ? 0.15 : -0.15, 0]}
                >
                  <mesh position={[0, -0.17, -0.02]}>
                    <cylinderGeometry args={[0.02, 0.028, 0.16, 8]} />
                    <meshStandardMaterial color="#3F3F46" metalness={0.7} roughness={0.3} />
                  </mesh>
                  <mesh castShadow>
                    <boxGeometry args={[0.49, 0.30, 0.025]} />
                    <meshStandardMaterial color="#18181B" metalness={0.45} roughness={0.35} />
                  </mesh>
                  <mesh position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
                    <planeGeometry args={[0.46, 0.27]} />
                    <meshStandardMaterial
                      map={monitorTexture ?? undefined}
                      emissiveMap={monitorTexture ?? undefined}
                      emissive={screenEmissive}
                      emissiveIntensity={screenIntensity}
                      roughness={0.2}
                    />
                  </mesh>
                </group>
              ))}

              {/* Brushed Brass Desk Lamp */}
              <group position={[0.62, 0.765, 0.22]}>
                <mesh position={[0, 0.015, 0]}>
                  <cylinderGeometry args={[0.06, 0.065, 0.03, 14]} />
                  <meshStandardMaterial color="#D4A853" metalness={0.75} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0.15, 0]}>
                  <cylinderGeometry args={[0.012, 0.012, 0.26, 8]} />
                  <meshStandardMaterial color="#D4A853" metalness={0.75} roughness={0.3} />
                </mesh>
                <mesh position={[-0.04, 0.28, -0.03]} rotation={[0.4, 0, 0]}>
                  <coneGeometry args={[0.07, 0.10, 14]} />
                  <meshStandardMaterial
                    color="#D4A853"
                    emissive="#FDE68A"
                    emissiveIntensity={lightingMode === "night" ? 0.85 : 0.2}
                    metalness={0.7}
                    roughness={0.28}
                  />
                </mesh>
              </group>

              {/* Desk Pad & Keyboard */}
              <mesh position={[0, 0.768, -0.1]}>
                <boxGeometry args={[0.66, 0.01, 0.26]} />
                <meshStandardMaterial color="#18181B" roughness={0.88} />
              </mesh>
            </group>

            {/* Ergonomic Executive Chair (cushioned seat + contoured back + armrests + 5-star base) */}
            <group position={[pose.seatPos.x, 0, pose.seatPos.z]} rotation={[0, pose.yaw, 0]}>
              <mesh position={[0, 0.45, 0]} castShadow>
                <boxGeometry args={[0.46, 0.075, 0.44]} />
                <meshStandardMaterial color={chairFabric} roughness={0.75} />
              </mesh>
              <mesh position={[0, 0.77, -0.2]} castShadow>
                <boxGeometry args={[0.42, 0.54, 0.065]} />
                <meshStandardMaterial color={chairFabric} roughness={0.75} />
              </mesh>
              <mesh position={[-0.24, 0.56, -0.02]}>
                <boxGeometry args={[0.045, 0.04, 0.26]} />
                <meshStandardMaterial color="#27272A" roughness={0.5} />
              </mesh>
              <mesh position={[0.24, 0.56, -0.02]}>
                <boxGeometry args={[0.045, 0.04, 0.26]} />
                <meshStandardMaterial color="#27272A" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.22, 0]}>
                <cylinderGeometry args={[0.035, 0.045, 0.40, 10]} />
                <meshStandardMaterial color="#52525B" metalness={0.7} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.03, 0]}>
                <cylinderGeometry args={[0.24, 0.26, 0.03, 5]} />
                <meshStandardMaterial color="#3F3F46" metalness={0.65} roughness={0.4} />
              </mesh>
            </group>
          </group>
        );
      })}

      {/* Boardroom Oval Walnut Table + Brass Pedestal Trim + 6 Chairs */}
      <group
        position={[meetingTable.center.x, 0, meetingTable.center.z]}
        onClick={(e) => {
          e.stopPropagation();
          onOpenMeetingView();
        }}
      >
        <mesh
          position={[0, 0.74, 0]}
          scale={[meetingTable.rx, 1, meetingTable.rz]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[1, 1, 0.055, 36]} />
          <meshStandardMaterial color={woodColor} roughness={0.44} />
        </mesh>
        <mesh position={[0, 0.77, 0]} scale={[meetingTable.rx * 0.45, 1, meetingTable.rz * 0.45]}>
          <cylinderGeometry args={[1, 1, 0.01, 24]} />
          <meshStandardMaterial color="#D4A853" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.37, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.32, 0.72, 18]} />
          <meshStandardMaterial color="#27272D" metalness={0.55} roughness={0.4} />
        </mesh>
      </group>

      {meetingSeats.map((seat) => (
        <group
          key={seat.seatIndex}
          position={[seat.seatPos.x, 0, seat.seatPos.z]}
          rotation={[0, seat.lookAtYaw, 0]}
        >
          <mesh position={[0, 0.43, 0]} castShadow>
            <boxGeometry args={[0.40, 0.065, 0.38]} />
            <meshStandardMaterial color={chairFabric} roughness={0.78} />
          </mesh>
          <mesh position={[0, 0.69, -0.17]} castShadow>
            <boxGeometry args={[0.36, 0.42, 0.055]} />
            <meshStandardMaterial color={chairFabric} roughness={0.78} />
          </mesh>
        </group>
      ))}

      {/* Sculpted Lounge Suite: Sofa, Walnut Coffee Table & Illuminated Espresso Bar */}
      {loungeBox && (
        <group>
          <group position={loungeBox.sofaCenter}>
            <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.06, 0.38, 0.76]} />
              <meshStandardMaterial color="#2A2A32" roughness={0.85} />
            </mesh>
            <mesh position={[0, 0.53, 0.28]} castShadow>
              <boxGeometry args={[2.06, 0.44, 0.18]} />
              <meshStandardMaterial color="#222229" roughness={0.85} />
            </mesh>
            {/* Accent throw cushion */}
            <mesh position={[-0.7, 0.46, 0.1]} rotation={[0.2, 0.2, 0]} castShadow>
              <boxGeometry args={[0.34, 0.26, 0.1]} />
              <meshStandardMaterial color="#D4A853" roughness={0.8} />
            </mesh>
          </group>

          {/* Low Coffee Table */}
          <group position={loungeBox.coffeeTableCenter}>
            <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.38, 0.38, 0.04, 24]} />
              <meshStandardMaterial color={woodColor} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.18, 0]}>
              <cylinderGeometry args={[0.04, 0.12, 0.36, 12]} />
              <meshStandardMaterial color="#27272A" metalness={0.65} />
            </mesh>
          </group>

          {/* Architectural Espresso Bar Counter */}
          <group position={loungeBox.coffeeBarCenter}>
            <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.64, 0.96, 0.56]} />
              <meshStandardMaterial color="#18181B" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0.98, 0]} castShadow>
              <boxGeometry args={[1.7, 0.055, 0.62]} />
              <meshStandardMaterial color={woodColor} roughness={0.42} />
            </mesh>
            <mesh position={[0, 0.94, 0.285]}>
              <boxGeometry args={[1.6, 0.015, 0.015]} />
              <meshStandardMaterial
                color="#D4A853"
                emissive="#D4A853"
                emissiveIntensity={lightingMode === "night" ? 1.2 : 0.3}
              />
            </mesh>
            {/* Brushed Espresso Machine */}
            <mesh position={[-0.28, 1.16, 0]} castShadow>
              <boxGeometry args={[0.34, 0.32, 0.28]} />
              <meshStandardMaterial color="#A1A1AA" metalness={0.82} roughness={0.22} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
}
