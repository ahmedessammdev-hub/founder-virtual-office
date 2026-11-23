import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { OfficeFloorplan } from "@virtual-office/shared";
import { PX_PER_METER, getMeetingTableWorld, pxToWorld } from "./coordinates.ts";
import type { PartitionSegmentWorld } from "./navgrid.ts";

interface ArchitecturalRoomProps {
  floorplan: OfficeFloorplan;
  partitionSegments: PartitionSegmentWorld[];
  lightingMode: "day" | "night";
}

function getThemePalette(theme: OfficeFloorplan["theme"], lightingMode: "day" | "night") {
  const isNight = lightingMode === "night";
  if (theme === "blueprint_slate") {
    return {
      floorBase: isNight ? "#22242C" : "#40485A",
      floorGrain: isNight ? "#17181E" : "#303645",
      wall: isNight ? "#141519" : "#E2E8F0",
      trim: isNight ? "#2B2B33" : "#64748B",
      glass: isNight ? "#71717A" : "#93C5FD",
      rugMeeting: isNight ? "#18181D" : "#CBD5E1",
      rugManager: isNight ? "#1A1916" : "#DBEAFE",
      rugLounge: isNight ? "#16161B" : "#E2E8F0",
    };
  }
  if (theme === "warm_sand") {
    return {
      floorBase: isNight ? "#4A3A2C" : "#C9AA85",
      floorGrain: isNight ? "#35281D" : "#B28E66",
      wall: isNight ? "#181614" : "#F3EFE7",
      trim: isNight ? "#332E2A" : "#8C7A68",
      glass: isNight ? "#D4A853" : "#CBD5E1",
      rugMeeting: isNight ? "#1E1B18" : "#E7DDD0",
      rugManager: isNight ? "#201C16" : "#DFD3C3",
      rugLounge: isNight ? "#1B1815" : "#EAE0D2",
    };
  }
  // Obsidian Evening walnut & Sunlit Oak studio default
  return {
    floorBase: isNight ? "#3D2F24" : "#C79E70",
    floorGrain: isNight ? "#2A1F17" : "#AF8252",
    wall: isNight ? "#141418" : "#F2EFE9",
    trim: isNight ? "#27272E" : "#94A3B8",
    glass: isNight ? "#A1A1AA" : "#BAE6FD",
    rugMeeting: isNight ? "#19191E" : "#E5E2DB",
    rugManager: isNight ? "#1B1914" : "#E7E2D8",
    rugLounge: isNight ? "#17171B" : "#ECE7DE",
  };
}

function createWoodPlankTexture(baseHex: string, grainHex: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  const plankRows = 10;
  const rowH = 512 / plankRows;
  for (let r = 0; r < plankRows; r += 1) {
    const y = r * rowH;
    const toneDelta = ((r * 37) % 5) - 2;
    ctx.fillStyle =
      toneDelta > 0
        ? `rgba(255,255,255,${0.015 * toneDelta})`
        : `rgba(0,0,0,${0.02 * Math.abs(toneDelta)})`;
    ctx.fillRect(0, y, 512, rowH);

    // Fine longitudinal wood grain lines
    ctx.strokeStyle = grainHex;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y + (rowH * g) / 4);
      ctx.lineTo(512, y + (rowH * g) / 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = grainHex;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();

    const offset = (r % 3) * 140;
    for (let x = offset; x < 512; x += 256) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rowH);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStrategyScreenTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#09090B";
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = "#27272E";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, 492, 236);

  // Header accent
  ctx.fillStyle = "#D4A853";
  ctx.fillRect(28, 28, 120, 8);
  ctx.fillStyle = "#3F3F46";
  ctx.fillRect(28, 46, 220, 5);

  // Clean KPI blocks & spark bars
  const heights = [42, 68, 54, 92, 78, 106, 118];
  heights.forEach((h, i) => {
    ctx.fillStyle = i === heights.length - 1 ? "#D4A853" : "#2E2E36";
    ctx.fillRect(36 + i * 36, 200 - h, 22, h);
  });

  // Architectural sprint nodes
  ctx.strokeStyle = "#34D399";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(310, 170);
  ctx.lineTo(365, 132);
  ctx.lineTo(420, 145);
  ctx.lineTo(474, 86);
  ctx.stroke();
  [
    [310, 170],
    [365, 132],
    [420, 145],
    [474, 86],
  ].forEach(([x, y]) => {
    ctx.fillStyle = "#D4A853";
    ctx.beginPath();
    ctx.arc(x!, y!, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function ArchitecturalRoom({
  floorplan,
  partitionSegments,
  lightingMode,
}: ArchitecturalRoomProps) {
  const widthM = floorplan.width / PX_PER_METER;
  const heightM = floorplan.height / PX_PER_METER;
  const palette = getThemePalette(floorplan.theme, lightingMode);
  const meetingTable = useMemo(() => getMeetingTableWorld(floorplan), [floorplan]);
  const managerZone = floorplan.zones.find((z) => z.kind === "manager_office");
  const meetingZone = floorplan.zones.find((z) => z.kind === "meeting_room");

  const floorTexture = useMemo(
    () => createWoodPlankTexture(palette.floorBase, palette.floorGrain),
    [palette.floorBase, palette.floorGrain],
  );
  const strategyTexture = useMemo(() => createStrategyScreenTexture(), []);

  useEffect(() => {
    return () => {
      floorTexture?.dispose();
    };
  }, [floorTexture]);

  useEffect(() => {
    return () => {
      strategyTexture?.dispose();
    };
  }, [strategyTexture]);

  const plantPositions = useMemo(() => {
    const hw = widthM / 2;
    const hh = heightM / 2;
    return [
      [-hw + 0.45, 0, -hh + 0.45],
      [hw - 0.45, 0, -hh + 0.45],
      [hw - 0.45, 0, hh - 0.45],
      [-hw + 0.45, 0, hh - 0.45],
    ] as Array<[number, number, number]>;
  }, [widthM, heightM]);

  const credenzaPos = useMemo(() => {
    if (!managerZone) return [-4.8, 0, -3.1] as [number, number, number];
    const p = pxToWorld(managerZone.x + 58, managerZone.y + managerZone.height * 0.5, floorplan, 0);
    return [p.x, 0, p.z] as [number, number, number];
  }, [managerZone, floorplan]);

  const boardroomScreenZ = useMemo(() => {
    if (!meetingZone) return 1.6;
    const p = pxToWorld(meetingZone.x, meetingZone.y + meetingZone.height / 2, floorplan, 0);
    return p.z;
  }, [meetingZone, floorplan]);

  return (
    <group>
      {/* Architectural Studio Base Plinth (edges align cleanly with Obsidian dark ground) */}
      <mesh position={[0, -0.07, 0]} receiveShadow>
        <boxGeometry args={[widthM + 0.28, 0.14, heightM + 0.28]} />
        <meshStandardMaterial color={lightingMode === "night" ? "#0D0D10" : "#D6D1C7"} roughness={0.85} />
      </mesh>

      {/* Main Studio Walnut / Oak Plank Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[widthM, heightM]} />
        <meshStandardMaterial
          map={floorTexture ?? undefined}
          color={floorTexture ? "#FFFFFF" : palette.floorBase}
          roughness={0.72}
          metalness={0.05}
        />
      </mesh>

      {/* Woven Zone Rugs with Thin Brass Trim Border */}
      {floorplan.zones.map((zone) => {
        if (zone.kind === "workstations") return null;
        const center = pxToWorld(zone.x + zone.width / 2, zone.y + zone.height / 2, floorplan, 0.005);
        const zw = Math.max(0.8, zone.width / PX_PER_METER - 0.35);
        const zd = Math.max(0.8, zone.height / PX_PER_METER - 0.35);
        const rugColor =
          zone.kind === "manager_office"
            ? palette.rugManager
            : zone.kind === "meeting_room"
              ? palette.rugMeeting
              : palette.rugLounge;
        return (
          <group key={zone.id} position={[center.x, 0.006, center.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[zw, zd]} />
              <meshStandardMaterial color={rugColor} roughness={0.94} />
            </mesh>
            <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[Math.min(zw, zd) * 0.44, Math.min(zw, zd) * 0.45, 4]} />
              <meshBasicMaterial color="#D4A853" transparent opacity={0.14} />
            </mesh>
          </group>
        );
      })}

      {/* Outer Perimeter Walls + Architectural North Glazing */}
      <mesh position={[0, 1.45, -heightM / 2]} castShadow receiveShadow>
        <boxGeometry args={[widthM, 2.9, 0.14]} />
        <meshStandardMaterial color={palette.wall} roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.55, -heightM / 2 + 0.08]}>
        <boxGeometry args={[widthM * 0.56, 1.48, 0.04]} />
        <meshStandardMaterial
          color={lightingMode === "night" ? "#1E222B" : "#BAE6FD"}
          emissive={lightingMode === "night" ? "#181B24" : "#E0F2FE"}
          emissiveIntensity={lightingMode === "night" ? 0.35 : 0.4}
          transparent
          opacity={0.55}
          roughness={0.12}
        />
      </mesh>
      {/* Window Mullion Frame */}
      <mesh position={[0, 2.31, -heightM / 2 + 0.09]}>
        <boxGeometry args={[widthM * 0.56 + 0.08, 0.05, 0.06]} />
        <meshStandardMaterial color={palette.trim} metalness={0.4} roughness={0.4} />
      </mesh>

      {/* West & East Walls */}
      <mesh position={[-widthM / 2, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 2.9, heightM]} />
        <meshStandardMaterial color={palette.wall} roughness={0.85} />
      </mesh>
      <mesh position={[widthM / 2, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 2.9, heightM]} />
        <meshStandardMaterial color={palette.wall} roughness={0.85} />
      </mesh>

      {/* South Low Cutaway Plinth */}
      <mesh position={[0, 0.14, heightM / 2]} receiveShadow>
        <boxGeometry args={[widthM, 0.28, 0.12]} />
        <meshStandardMaterial color={palette.trim} roughness={0.65} />
      </mesh>

      {/* Executive Credenza inside Manager Office */}
      <group position={credenzaPos}>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.38, 0.84, 1.45]} />
          <meshStandardMaterial color={lightingMode === "night" ? "#26201B" : "#8B6948"} roughness={0.55} />
        </mesh>
        <mesh position={[0.04, 0.86, 0]}>
          <boxGeometry args={[0.34, 0.04, 1.48]} />
          <meshStandardMaterial color="#D4A853" metalness={0.65} roughness={0.35} />
        </mesh>
      </group>

      {/* Boardroom Strategy Wall Screen */}
      <group position={[-widthM / 2 + 0.11, 1.48, boardroomScreenZ]} rotation={[0, Math.PI / 2, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.68, 0.88, 0.05]} />
          <meshStandardMaterial color="#18181B" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <planeGeometry args={[1.58, 0.78]} />
          <meshStandardMaterial
            map={strategyTexture ?? undefined}
            emissiveMap={strategyTexture ?? undefined}
            emissive="#FFFFFF"
            emissiveIntensity={0.7}
            roughness={0.2}
          />
        </mesh>
      </group>

      {/* Suspended Brushed-Brass Linear Pendant over Meeting Room Table */}
      <group position={[meetingTable.center.x, 2.32, meetingTable.center.z]}>
        <mesh position={[0, 0.28, -0.42]}>
          <cylinderGeometry args={[0.01, 0.01, 0.56, 6]} />
          <meshStandardMaterial color="#52525B" metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.28, 0.42]}>
          <cylinderGeometry args={[0.01, 0.01, 0.56, 6]} />
          <meshStandardMaterial color="#52525B" metalness={0.7} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.10, 0.06, 1.35]} />
          <meshStandardMaterial color="#D4A853" metalness={0.75} roughness={0.28} />
        </mesh>
        <mesh position={[0, -0.032, 0]}>
          <boxGeometry args={[0.07, 0.012, 1.28]} />
          <meshStandardMaterial
            color="#FFFBEB"
            emissive="#FCD34D"
            emissiveIntensity={lightingMode === "night" ? 1.8 : 0.7}
          />
        </mesh>
      </group>

      {/* Interior Translucent Anodized-Bronze Glass Partitions */}
      {partitionSegments.map((seg, i) => {
        const len = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
        if (len < 0.08) return null;
        const cx = (seg.x1 + seg.x2) / 2;
        const cz = (seg.z1 + seg.z2) / 2;
        const angle = Math.atan2(seg.z2 - seg.z1, seg.x2 - seg.x1);
        return (
          <group key={`${seg.zoneId}-${i}`} position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
            <mesh position={[0, 0.07, 0]} castShadow>
              <boxGeometry args={[len, 0.14, 0.075]} />
              <meshStandardMaterial color={palette.trim} roughness={0.4} metalness={0.55} />
            </mesh>
            <mesh position={[0, 1.18, 0]}>
              <boxGeometry args={[len, 2.08, 0.025]} />
              <meshStandardMaterial
                color={palette.glass}
                transparent
                opacity={lightingMode === "night" ? 0.16 : 0.24}
                roughness={0.08}
                metalness={0.15}
              />
            </mesh>
            <mesh position={[0, 2.23, 0]}>
              <boxGeometry args={[len, 0.055, 0.075]} />
              <meshStandardMaterial color={palette.trim} roughness={0.4} metalness={0.55} />
            </mesh>
          </group>
        );
      })}

      {/* Sculpted Ceramic Planters with Multi-Leaf Foliage */}
      {plantPositions.map((pos, idx) => (
        <group key={idx} position={pos}>
          <mesh position={[0, 0.2, 0]} castShadow>
            <cylinderGeometry args={[0.17, 0.13, 0.4, 16]} />
            <meshStandardMaterial color={lightingMode === "night" ? "#27272A" : "#E5E7EB"} roughness={0.65} />
          </mesh>
          <mesh position={[0, 0.41, 0]}>
            <cylinderGeometry args={[0.176, 0.176, 0.025, 16]} />
            <meshStandardMaterial color="#D4A853" metalness={0.6} roughness={0.35} />
          </mesh>
          {/* Multi-cluster organic foliage */}
          <mesh position={[0, 0.62, 0]} castShadow>
            <sphereGeometry args={[0.20, 12, 10]} />
            <meshStandardMaterial color="#166534" roughness={0.82} />
          </mesh>
          <mesh position={[0.11, 0.56, 0.08]} castShadow>
            <sphereGeometry args={[0.14, 10, 8]} />
            <meshStandardMaterial color="#15803D" roughness={0.82} />
          </mesh>
          <mesh position={[-0.1, 0.68, -0.07]} castShadow>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color="#14532D" roughness={0.82} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
