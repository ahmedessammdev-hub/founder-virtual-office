import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AvatarStatusOverlay } from "./AvatarStatusOverlay.tsx";
import { ProceduralAvatar } from "./ProceduralAvatar.tsx";
import { animStateToClipName, type AvatarAdapterProps, type AvatarClipName } from "./types.ts";

class GlbErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function RiggedGlbAvatarInner({
  employee,
  deptColor,
  agentsMapRef,
  operationalMode,
  activeToolName,
  selected,
  hovered,
  reducedMotion,
  locale,
  modelUrl = "/assets/avatars/sample-rigged.glb",
  onSelect,
  onHoverChange,
}: AvatarAdapterProps) {
  const gltf = useGLTF(modelUrl);
  const rootRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const activeClipRef = useRef<AvatarClipName | null>(null);
  const tintHex = employee.profile.avatarTone ?? deptColor;

  const clonedScene = useMemo(() => cloneSkinned(gltf.scene), [gltf]);

  useEffect(() => {
    const tint = new THREE.Color(tintHex);
    const matList: THREE.Material[] = [];

    clonedScene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => {
              const cloned = m.clone();
              if (cloned instanceof THREE.MeshStandardMaterial) {
                cloned.color.copy(tint);
              }
              matList.push(cloned);
              return cloned;
            });
          } else {
            const cloned = mesh.material.clone();
            if (cloned instanceof THREE.MeshStandardMaterial) {
              cloned.color.copy(tint);
            }
            matList.push(cloned);
            mesh.material = cloned;
          }
        }
      }
    });

    const animMixer = new THREE.AnimationMixer(clonedScene);
    const clipActions = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      clipActions.set(clip.name, animMixer.clipAction(clip, clonedScene));
    }

    mixerRef.current = animMixer;
    actionsRef.current = clipActions;
    headBoneRef.current = clonedScene.getObjectByName("Head") ?? null;

    const initial =
      clipActions.get("Sit") ?? clipActions.get("Idle") ?? Array.from(clipActions.values())[0];
    if (initial) {
      initial.reset().play();
      activeClipRef.current = (initial.getClip().name as AvatarClipName) ?? "Idle";
    }

    return () => {
      animMixer.stopAllAction();
      animMixer.uncacheRoot(clonedScene);
      mixerRef.current = null;
      actionsRef.current = new Map();
      headBoneRef.current = null;
      activeClipRef.current = null;
      for (const m of matList) {
        m.dispose();
      }
    };
  }, [clonedScene, gltf.animations, tintHex]);

  useFrame((_state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const agent = agentsMapRef.current[employee.profile.id];
    const root = rootRef.current;
    const mixer = mixerRef.current;
    if (!agent || !root) return;

    root.position.set(agent.position.x, agent.position.y, agent.position.z);
    root.rotation.y = agent.yaw;

    const actions = actionsRef.current;
    const desiredClip = animStateToClipName(agent.animState);
    if (desiredClip !== activeClipRef.current && actions.size > 0) {
      const nextAction = actions.get(desiredClip) ?? actions.get("Idle");
      const prevAction = activeClipRef.current ? actions.get(activeClipRef.current) : undefined;
      if (nextAction) {
        nextAction.reset();
        nextAction.enabled = true;
        if (desiredClip === "Walk") {
          nextAction.timeScale = Math.max(0.6, agent.currentSpeed / 1.5);
        } else {
          nextAction.timeScale = 1;
        }
        if (prevAction && prevAction !== nextAction) {
          prevAction.crossFadeTo(nextAction, reducedMotion ? 0.05 : 0.25, true);
        }
        nextAction.play();
        activeClipRef.current = desiredClip;
      }
    }

    mixer?.update(dt);

    const headBone = headBoneRef.current;
    if (headBone && agent.lookAtTarget && desiredClip !== "Walk") {
      const worldYaw = Math.atan2(
        agent.lookAtTarget.x - agent.position.x,
        agent.lookAtTarget.z - agent.position.z,
      );
      let rel = worldYaw - agent.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      headBone.rotation.y = THREE.MathUtils.lerp(
        headBone.rotation.y,
        THREE.MathUtils.clamp(rel, -0.7, 0.7),
        dt * 7,
      );
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
      <primitive object={clonedScene} />

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

export function RiggedGlbAvatar(props: AvatarAdapterProps) {
  const fallback = <ProceduralAvatar {...props} />;
  return (
    <GlbErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <RiggedGlbAvatarInner {...props} />
      </Suspense>
    </GlbErrorBoundary>
  );
}
