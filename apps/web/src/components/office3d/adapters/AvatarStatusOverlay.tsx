import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { LoadedEmployee } from "@virtual-office/shared";
import type { Locale } from "../../../i18n/translations.ts";
import type { EmployeeLiveStatus } from "../../../store/office-store.ts";

interface AvatarStatusOverlayProps {
  employee: LoadedEmployee;
  operationalMode: EmployeeLiveStatus | "meeting";
  activeToolName: string | null;
  selected: boolean;
  hovered: boolean;
  reducedMotion: boolean;
  locale: Locale;
}

export function AvatarStatusOverlay({
  employee,
  operationalMode,
  activeToolName,
  selected,
  hovered,
  reducedMotion,
  locale,
}: AvatarStatusOverlayProps) {
  const haloRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!haloRef.current) return;
    const s = reducedMotion ? 1 : 1 + Math.sin(state.clock.elapsedTime * 4.5) * 0.1;
    haloRef.current.scale.set(s, s, 1);
  });

  const showBadge = hovered || selected || operationalMode !== "idle";
  const statusColor =
    operationalMode === "waiting_approval"
      ? "#F59E0B"
      : operationalMode === "working" || operationalMode === "queued"
        ? "#34D399"
        : operationalMode === "meeting"
          ? "#D4A853"
          : operationalMode === "failed"
            ? "#F87171"
            : "#A1A1AA";

  const statusText =
    operationalMode === "waiting_approval"
      ? locale === "ar"
        ? "موافقة"
        : "Approval"
      : operationalMode === "working"
        ? activeToolName ?? (locale === "ar" ? "يعمل" : "Working")
        : operationalMode === "meeting"
          ? locale === "ar"
            ? "اجتماع"
            : "Meeting"
          : operationalMode === "failed"
            ? locale === "ar"
              ? "تعثر"
              : "Failed"
            : locale === "ar"
              ? "متاح"
              : "Idle";

  return (
    <>
      {(operationalMode === "waiting_approval" || operationalMode === "failed") && (
        <mesh ref={haloRef} position={[0, 1.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.22, 0.032, 10, 28]} />
          <meshStandardMaterial
            color={statusColor}
            emissive={statusColor}
            emissiveIntensity={1.6}
          />
        </mesh>
      )}

      {(selected || operationalMode === "working") && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.34, 0.41, 28]} />
          <meshBasicMaterial
            color={selected ? "#D4A853" : "#34D399"}
            transparent
            opacity={0.78}
          />
        </mesh>
      )}

      {showBadge && (
        <Html
          position={[0, 2.22, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: "none" }}
        >
          <div className="px-2.5 py-1 rounded-full border border-white/15 bg-[#111113]/95 text-[#F4F4F6] text-[11px] whitespace-nowrap shadow-xl backdrop-blur flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
            />
            <span className="font-semibold">
              {locale === "ar" ? employee.profile.nameAr : employee.profile.name}
            </span>
            <span className="text-[10px] font-mono opacity-75">{statusText}</span>
          </div>
        </Html>
      )}
    </>
  );
}
