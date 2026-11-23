import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OfficeFloorplan, TaskPlan } from "@virtual-office/shared";
import { getDeskPoseWorld } from "./coordinates.ts";

interface DagHandoffArcsProps {
  taskPlans: TaskPlan[];
  floorplan: OfficeFloorplan;
  reducedMotion: boolean;
}

interface ArcItem {
  id: string;
  points: [number, number, number][];
  curve: THREE.QuadraticBezierCurve3;
}

export function DagHandoffArcs({
  taskPlans,
  floorplan,
  reducedMotion,
}: DagHandoffArcsProps) {
  const pulseRefs = useRef<Array<THREE.Mesh | null>>([]);

  const arcs = useMemo<ArcItem[]>(() => {
    const runningPlans = taskPlans.filter((p) => p.status === "RUNNING");
    if (runningPlans.length === 0) return [];

    const deskCenterByEmp = new Map<string, THREE.Vector3>();
    for (const desk of floorplan.desks) {
      if (!desk.employeeId) continue;
      const pose = getDeskPoseWorld(desk, floorplan);
      deskCenterByEmp.set(desk.employeeId, new THREE.Vector3(pose.center.x, 1.18, pose.center.z));
    }

    const out: ArcItem[] = [];
    const seen = new Set<string>();

    for (const plan of runningPlans) {
      const nodeMap = new Map<string, (typeof plan.nodes)[number]>();
      for (const n of plan.nodes) {
        nodeMap.set(n.id, n);
        nodeMap.set(n.nodeKey, n);
      }

      for (const node of plan.nodes) {
        const target = deskCenterByEmp.get(node.assignedEmployeeId);
        if (!target) continue;
        for (const dep of node.dependsOn) {
          const upstream = nodeMap.get(dep);
          const source = upstream ? deskCenterByEmp.get(upstream.assignedEmployeeId) : undefined;
          if (!source || source.distanceTo(target) < 0.2) continue;

          const id = `${plan.id}:${upstream!.assignedEmployeeId}->${node.assignedEmployeeId}`;
          if (seen.has(id)) continue;
          seen.add(id);

          const mid = new THREE.Vector3()
            .addVectors(source, target)
            .multiplyScalar(0.5);
          mid.y += Math.min(2.6, 1.1 + source.distanceTo(target) * 0.22);

          const curve = new THREE.QuadraticBezierCurve3(source, mid, target);
          const pts = curve.getPoints(24).map((p) => [p.x, p.y, p.z] as [number, number, number]);
          out.push({ id, points: pts, curve });
        }
      }
    }

    return out;
  }, [taskPlans, floorplan]);

  useFrame((state) => {
    if (reducedMotion || arcs.length === 0) return;
    const t = (state.clock.elapsedTime * 0.45) % 1;
    arcs.forEach((arc, idx) => {
      const bead = pulseRefs.current[idx];
      if (!bead) return;
      const pt = arc.curve.getPointAt((t + idx * 0.21) % 1);
      bead.position.copy(pt);
    });
  });

  if (arcs.length === 0) return null;

  return (
    <group>
      {arcs.map((arc, idx) => (
        <group key={arc.id}>
          <Line
            points={arc.points}
            color="#D4A853"
            lineWidth={2}
            dashed
            dashSize={0.25}
            gapSize={0.14}
            transparent
            opacity={0.9}
          />
          {!reducedMotion && (
            <mesh
              ref={(el) => {
                pulseRefs.current[idx] = el;
              }}
            >
              <sphereGeometry args={[0.07, 10, 10]} />
              <meshStandardMaterial
                color="#34D399"
                emissive="#34D399"
                emissiveIntensity={1.6}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
