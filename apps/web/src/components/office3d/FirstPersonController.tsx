import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { LoadedEmployee, OfficeFloorplan } from "@virtual-office/shared";
import type { AvatarAgentState } from "./behavior-controller.ts";
import { dist2D, getMeetingTableWorld, type WorldVec3 } from "./coordinates.ts";
import { clampWalkablePosition, type OfficeNavGrid } from "./navgrid.ts";

export interface ProximityPromptTarget {
  kind: "employee" | "meeting";
  id: string;
  label: string;
}

interface FirstPersonControllerProps {
  navGrid: OfficeNavGrid;
  floorplan: OfficeFloorplan;
  employees: LoadedEmployee[];
  agentsMapRef: MutableRefObject<Record<string, AvatarAgentState>>;
  locale: "ar" | "en";
  onProximityChange: (target: ProximityPromptTarget | null) => void;
  onActivateTarget: (target: ProximityPromptTarget) => void;
}

export function FirstPersonController({
  navGrid,
  floorplan,
  employees,
  agentsMapRef,
  locale,
  onProximityChange,
  onActivateTarget,
}: FirstPersonControllerProps) {
  const { camera, gl } = useThree();
  const keysRef = useRef<Set<string>>(new Set());
  const posRef = useRef<WorldVec3>({ x: 0.4, y: 1.62, z: 1.4 });
  const yawRef = useRef(Math.PI * 0.15);
  const pitchRef = useRef(-0.08);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const nearestRef = useRef<ProximityPromptTarget | null>(null);
  const probeAccumRef = useRef(0);

  // Temporary pooled math objects so useFrame never allocates per tick
  const fwdVec = useRef(new THREE.Vector3());
  const rightVec = useRef(new THREE.Vector3());

  useEffect(() => {
    const start = clampWalkablePosition(
      navGrid,
      { x: 0, y: 1.62, z: 0 },
      { x: 0.2, y: 1.62, z: 1.4 },
      0.24,
    );
    posRef.current = { x: start.x, y: 1.62, z: start.z };
    camera.position.set(start.x, 1.62, start.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchRef.current, yawRef.current, 0);
  }, [navGrid, camera]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const code = e.code;
      keysRef.current.add(code);
      if (code === "KeyE" && nearestRef.current) {
        e.preventDefault();
        onActivateTarget(nearestRef.current);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    const dom = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      yawRef.current -= dx * 0.0045;
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - dy * 0.0035, -0.65, 0.45);
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      onProximityChange(null);
    };
  }, [gl.domElement, onActivateTarget, onProximityChange]);

  useFrame((_state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const keys = keysRef.current;

    let forwardInput = 0;
    let strafeInput = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) forwardInput += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) forwardInput -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) strafeInput += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) strafeInput -= 1;

    if (forwardInput !== 0 || strafeInput !== 0) {
      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.65 : 1;
      const speed = 3.8 * sprint;
      fwdVec.current.set(-Math.sin(yawRef.current), 0, -Math.cos(yawRef.current)).normalize();
      rightVec.current.set(Math.cos(yawRef.current), 0, -Math.sin(yawRef.current)).normalize();

      const moveX =
        (fwdVec.current.x * forwardInput + rightVec.current.x * strafeInput);
      const moveZ =
        (fwdVec.current.z * forwardInput + rightVec.current.z * strafeInput);
      const len = Math.hypot(moveX, moveZ) || 1;

      const nextPos: WorldVec3 = {
        x: posRef.current.x + (moveX / len) * speed * dt,
        y: 1.62,
        z: posRef.current.z + (moveZ / len) * speed * dt,
      };
      const clamped = clampWalkablePosition(navGrid, posRef.current, nextPos, 0.24);
      posRef.current.x = clamped.x;
      posRef.current.z = clamped.z;
    }

    camera.position.set(posRef.current.x, 1.62, posRef.current.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchRef.current, yawRef.current, 0);

    // Throttled proximity check (~8 Hz) avoiding unnecessary store/React updates
    probeAccumRef.current += dt;
    if (probeAccumRef.current >= 0.12) {
      probeAccumRef.current = 0;
      let best: ProximityPromptTarget | null = null;
      let bestDist = 2.3;

      for (const emp of employees) {
        const ag = agentsMapRef.current[emp.profile.id];
        if (!ag) continue;
        const d = dist2D(posRef.current, ag.position);
        if (d < bestDist) {
          bestDist = d;
          const name = locale === "ar" ? emp.profile.nameAr : emp.profile.name;
          best = {
            kind: "employee",
            id: emp.profile.id,
            label:
              locale === "ar"
                ? `اضغط [E] للتحدث مع ${name}`
                : `Press [E] to chat with ${name}`,
          };
        }
      }

      const meetingTable = getMeetingTableWorld(floorplan);
      const mDist = dist2D(posRef.current, meetingTable.center);
      if (mDist < 2.2 && mDist < bestDist) {
        best = {
          kind: "meeting",
          id: "meeting-room",
          label:
            locale === "ar"
              ? "اضغط [E] لبدء اجتماع فريق في الغرفة"
              : "Press [E] to open Meeting Room",
        };
      }

      if (best?.id !== nearestRef.current?.id || best?.kind !== nearestRef.current?.kind) {
        nearestRef.current = best;
        onProximityChange(best);
      }
    }
  });

  return null;
}
