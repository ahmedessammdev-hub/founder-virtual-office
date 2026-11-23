import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { AvatarStatusOverlay } from "./AvatarStatusOverlay.tsx";
import type { AvatarAdapterProps } from "./types.ts";

function isSeatedAnim(animState: string): boolean {
  return (
    animState === "SeatedIdle" ||
    animState === "TypingActive" ||
    animState === "MeetingSeated" ||
    animState === "MeetingTalking" ||
    animState === "AlertFailed"
  );
}

const HAIR_COLOR_BY_ROLE: Record<string, string> = {
  "general-manager": "#1C1917",
  "hr-talent": "#3B2314",
  "senior-engineer": "#0F172A",
  "product-strategist": "#4A3222",
  "growth-marketer": "#27272A",
};

const SKIN_TONE_BY_EMP: Record<string, string> = {
  "general-manager": "#DFC0A5",
  "hr-talent": "#E6C9B2",
  "senior-engineer": "#D6B499",
  "product-strategist": "#E8CEB8",
  "growth-marketer": "#DFC1A7",
};

export function ProceduralAvatar({
  employee,
  deptColor,
  agentsMapRef,
  operationalMode,
  activeToolName,
  selected,
  hovered,
  reducedMotion,
  locale,
  onSelect,
  onHoverChange,
}: AvatarAdapterProps) {
  const rootRef = useRef<THREE.Group>(null);
  const hipsRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const walkPhaseRef = useRef(0);

  const jacketColor = employee.profile.avatarTone ?? deptColor;
  const hairColor = HAIR_COLOR_BY_ROLE[employee.profile.id] ?? "#18181B";
  const skinColor = SKIN_TONE_BY_EMP[employee.profile.id] ?? "#E2C3A9";
  const wearsHeadphones = employee.profile.department === "engineering";

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const agent = agentsMapRef.current[employee.profile.id];
    const root = rootRef.current;
    if (!agent || !root) return;

    root.position.set(agent.position.x, agent.position.y, agent.position.z);
    root.rotation.y = agent.yaw;

    const anim = agent.animState;
    const t = state.clock.elapsedTime;
    const seated = isSeatedAnim(anim);

    if (hipsRef.current) {
      let targetHipY = seated ? 0.56 : 0.90;
      if (!reducedMotion && anim === "Walking") {
        walkPhaseRef.current += agent.currentSpeed * dt * 3.1;
        targetHipY += Math.abs(Math.sin(walkPhaseRef.current)) * 0.032;
      } else if (!reducedMotion && anim !== "Walking") {
        targetHipY += Math.sin(t * 1.7) * 0.006;
      }
      hipsRef.current.position.y = THREE.MathUtils.lerp(hipsRef.current.position.y, targetHipY, dt * 10);
      hipsRef.current.position.z = THREE.MathUtils.lerp(hipsRef.current.position.z, seated ? -0.04 : 0, dt * 10);
    }

    if (torsoRef.current) {
      const targetPitch = anim === "TypingActive" ? 0.14 : anim === "MeetingTalking" ? 0.06 : 0;
      torsoRef.current.rotation.x = THREE.MathUtils.lerp(torsoRef.current.rotation.x, targetPitch, dt * 8);
    }

    if (headRef.current) {
      let targetHeadYaw = 0;
      let targetHeadPitch = anim === "TypingActive" ? 0.14 : 0;
      if (agent.lookAtTarget && anim !== "Walking") {
        const worldYaw = Math.atan2(
          agent.lookAtTarget.x - agent.position.x,
          agent.lookAtTarget.z - agent.position.z,
        );
        let rel = worldYaw - agent.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        targetHeadYaw = THREE.MathUtils.clamp(rel, -0.75, 0.75);
      } else if (!reducedMotion && anim === "AmbientLounge") {
        targetHeadYaw = Math.sin(t * 0.8) * 0.25;
      }
      if (!reducedMotion && anim === "MeetingTalking") {
        targetHeadPitch = Math.sin(t * 5.2) * 0.09;
      }
      headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetHeadYaw, dt * 7);
      headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetHeadPitch, dt * 7);
    }

    if (leftLegRef.current && rightLegRef.current) {
      let lRx = 0;
      let rRx = 0;
      if (seated) {
        lRx = -1.42;
        rRx = -1.42;
      } else if (anim === "Walking") {
        const swing = reducedMotion ? 0.25 : Math.sin(walkPhaseRef.current) * 0.55;
        lRx = swing;
        rRx = -swing;
      }
      leftLegRef.current.rotation.x = THREE.MathUtils.lerp(leftLegRef.current.rotation.x, lRx, dt * 11);
      rightLegRef.current.rotation.x = THREE.MathUtils.lerp(rightLegRef.current.rotation.x, rRx, dt * 11);
    }

    if (leftArmRef.current && rightArmRef.current) {
      let lRx = 0;
      let rRx = 0;
      let lRz = -0.09;
      let rRz = 0.09;

      if (anim === "TypingActive") {
        const tap = reducedMotion ? 0 : Math.sin(t * 13) * 0.14;
        lRx = -1.06 + tap;
        rRx = -1.06 - tap;
        lRz = -0.08;
        rRz = 0.08;
      } else if (anim === "HandRaiseApproval") {
        rRx = -2.62 + (reducedMotion ? 0 : Math.sin(t * 4) * 0.10);
        rRz = 0.20;
        lRx = 0.05;
      } else if (anim === "MeetingTalking") {
        const gest = reducedMotion ? 0 : Math.sin(t * 4.5) * 0.28;
        lRx = -0.78 + gest;
        rRx = -0.82 - gest;
        lRz = -0.18;
        rRz = 0.18;
      } else if (anim === "MeetingSeated" || anim === "SeatedIdle" || anim === "AlertFailed") {
        lRx = -0.42;
        rRx = -0.42;
      } else if (anim === "Walking") {
        const swing = reducedMotion ? 0.2 : Math.sin(walkPhaseRef.current) * 0.42;
        lRx = -swing;
        rRx = swing;
      } else {
        lRx = reducedMotion ? 0 : Math.sin(t * 1.4) * 0.04;
        rRx = reducedMotion ? 0 : -Math.sin(t * 1.4) * 0.04;
      }

      leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, lRx, dt * 10);
      rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, rRx, dt * 10);
      leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, lRz, dt * 10);
      rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, rRz, dt * 10);
    }
  });

  return (
    <group
      ref={rootRef}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(employee.profile.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverChange(employee.profile.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHoverChange(null);
        document.body.style.cursor = "auto";
      }}
    >
      {/* Sculpted Organic Humanoid Rig */}
      <group ref={hipsRef} position={[0, 0.90, 0]}>
        {/* Sculpted Pelvis */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.145, 0.135, 0.13, 16]} />
          <meshStandardMaterial color="#1D1D22" roughness={0.68} />
        </mesh>

        {/* Spine & Tailored Torso */}
        <group ref={torsoRef} position={[0, 0.07, 0]}>
          <mesh position={[0, 0.21, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.178, 0.138, 0.41, 18]} />
            <meshStandardMaterial color={jacketColor} roughness={0.5} metalness={0.06} />
          </mesh>
          {/* Crisp Tailored Shirt Collar / Lapel */}
          <mesh position={[0, 0.36, 0.115]} rotation={[0.18, 0, 0]}>
            <cylinderGeometry args={[0.072, 0.04, 0.12, 12]} />
            <meshStandardMaterial color="#F4F4F6" roughness={0.45} />
          </mesh>

          {/* Neck & Sculpted Sphere Head */}
          <group ref={headRef} position={[0, 0.44, 0]}>
            <mesh position={[0, 0.04, 0]}>
              <cylinderGeometry args={[0.046, 0.054, 0.10, 12]} />
              <meshStandardMaterial color={skinColor} roughness={0.55} />
            </mesh>
            <mesh position={[0, 0.175, 0]} castShadow>
              <sphereGeometry args={[0.142, 22, 16]} />
              <meshStandardMaterial color={skinColor} roughness={0.55} />
            </mesh>
            {/* Sculpted Hair Cap */}
            <mesh position={[0, 0.195, -0.014]} castShadow>
              <sphereGeometry args={[0.149, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
              <meshStandardMaterial color={hairColor} roughness={0.72} />
            </mesh>
            {/* Expressive Eyes facing +Z */}
            <mesh position={[-0.046, 0.178, 0.126]}>
              <sphereGeometry args={[0.014, 8, 8]} />
              <meshStandardMaterial color="#111113" roughness={0.25} />
            </mesh>
            <mesh position={[0.046, 0.178, 0.126]}>
              <sphereGeometry args={[0.014, 8, 8]} />
              <meshStandardMaterial color="#111113" roughness={0.25} />
            </mesh>

            {/* Studio Over-Ear Headphones for Engineering Specialists */}
            {wearsHeadphones && (
              <group position={[0, 0.185, 0]}>
                <mesh rotation={[0, 0, 0]}>
                  <torusGeometry args={[0.155, 0.015, 8, 20, Math.PI]} />
                  <meshStandardMaterial color="#27272A" metalness={0.5} roughness={0.35} />
                </mesh>
                <mesh position={[-0.155, -0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.042, 0.042, 0.032, 12]} />
                  <meshStandardMaterial color="#D4A853" metalness={0.6} roughness={0.35} />
                </mesh>
                <mesh position={[0.155, -0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.042, 0.042, 0.032, 12]} />
                  <meshStandardMaterial color="#D4A853" metalness={0.6} roughness={0.35} />
                </mesh>
              </group>
            )}
          </group>

          {/* Left Rounded Shoulder, Capsule Arm & Hand */}
          <group ref={leftArmRef} position={[-0.215, 0.37, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.056, 12, 10]} />
              <meshStandardMaterial color={jacketColor} roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.17, 0]} castShadow>
              <capsuleGeometry args={[0.046, 0.25, 6, 12]} />
              <meshStandardMaterial color={jacketColor} roughness={0.52} />
            </mesh>
            <mesh position={[0, -0.35, 0]}>
              <sphereGeometry args={[0.042, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.55} />
            </mesh>
          </group>

          {/* Right Rounded Shoulder, Capsule Arm & Hand */}
          <group ref={rightArmRef} position={[0.215, 0.37, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.056, 12, 10]} />
              <meshStandardMaterial color={jacketColor} roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.17, 0]} castShadow>
              <capsuleGeometry args={[0.046, 0.25, 6, 12]} />
              <meshStandardMaterial color={jacketColor} roughness={0.52} />
            </mesh>
            <mesh position={[0, -0.35, 0]}>
              <sphereGeometry args={[0.042, 10, 10]} />
              <meshStandardMaterial color={skinColor} roughness={0.55} />
            </mesh>
          </group>
        </group>

        {/* Left Sculpted Capsule Leg & Shoe */}
        <group ref={leftLegRef} position={[-0.088, -0.05, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow>
            <capsuleGeometry args={[0.058, 0.34, 6, 12]} />
            <meshStandardMaterial color="#18181B" roughness={0.72} />
          </mesh>
          <mesh position={[0, -0.44, 0.028]} castShadow>
            <capsuleGeometry args={[0.048, 0.06, 6, 10]} />
            <meshStandardMaterial color="#09090B" roughness={0.45} />
          </mesh>
        </group>

        {/* Right Sculpted Capsule Leg & Shoe */}
        <group ref={rightLegRef} position={[0.088, -0.05, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow>
            <capsuleGeometry args={[0.058, 0.34, 6, 12]} />
            <meshStandardMaterial color="#18181B" roughness={0.72} />
          </mesh>
          <mesh position={[0, -0.44, 0.028]} castShadow>
            <capsuleGeometry args={[0.048, 0.06, 6, 10]} />
            <meshStandardMaterial color="#09090B" roughness={0.45} />
          </mesh>
        </group>
      </group>

      <AvatarStatusOverlay
        employee={employee}
        operationalMode={operationalMode}
        activeToolName={activeToolName}
        selected={selected}
        hovered={hovered}
        reducedMotion={reducedMotion}
        locale={locale}
      />
    </group>
  );
}
