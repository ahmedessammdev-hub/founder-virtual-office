import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";

export interface CameraPresetTarget {
  seq: number;
  position: [number, number, number];
  target: [number, number, number];
}

interface CameraRigProps {
  preset: CameraPresetTarget;
  reducedMotion: boolean;
}

export function CameraRig({ preset, reducedMotion }: CameraRigProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const goalPos = useRef(new THREE.Vector3(...preset.position));
  const goalTarget = useRef(new THREE.Vector3(...preset.target));
  const animatingRef = useRef(true);

  useEffect(() => {
    goalPos.current.set(...preset.position);
    goalTarget.current.set(...preset.target);
    if (reducedMotion) {
      camera.position.copy(goalPos.current);
      if (controlsRef.current) {
        controlsRef.current.target.copy(goalTarget.current);
        controlsRef.current.update();
      }
      animatingRef.current = false;
    } else {
      animatingRef.current = true;
    }
  }, [preset, reducedMotion, camera]);

  useFrame((_state, rawDelta) => {
    if (!animatingRef.current || !controlsRef.current) return;
    const dt = Math.min(rawDelta, 0.05);
    const alpha = Math.min(1, dt * 6);
    camera.position.lerp(goalPos.current, alpha);
    controlsRef.current.target.lerp(goalTarget.current, alpha);
    controlsRef.current.update();

    if (
      camera.position.distanceTo(goalPos.current) < 0.06 &&
      controlsRef.current.target.distanceTo(goalTarget.current) < 0.06
    ) {
      animatingRef.current = false;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minPolarAngle={0.32}
      maxPolarAngle={1.24}
      minDistance={3.8}
      maxDistance={22}
      onStart={() => {
        animatingRef.current = false;
      }}
    />
  );
}
