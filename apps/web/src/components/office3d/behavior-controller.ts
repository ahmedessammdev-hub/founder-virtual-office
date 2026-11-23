import type { LoadedEmployee, MeetingRecord, OfficeFloorplan } from "@virtual-office/shared";
import type { EmployeeLiveStatus } from "../../store/office-store.ts";
import {
  dist2D,
  getDeskPoseWorld,
  getLoungeSpotsWorld,
  getMeetingSeatsWorld,
  getMeetingTableWorld,
  type WorldVec3,
} from "./coordinates.ts";
import { findPath, type OfficeNavGrid } from "./navgrid.ts";

export type AmbientLifeMode = "quiet" | "balanced" | "lively";

export type AvatarAnimState =
  | "SeatedIdle"
  | "Walking"
  | "TypingActive"
  | "HandRaiseApproval"
  | "MeetingSeated"
  | "MeetingTalking"
  | "AlertFailed"
  | "AmbientLounge";

export interface EmployeeBehaviorInput {
  employeeId: string;
  deskId: string;
  liveStatus: EmployeeLiveStatus;
  activeToolName: string | null;
}

export interface AvatarAgentState {
  employeeId: string;
  deskId: string;
  position: WorldVec3;
  yaw: number;
  lookAtTarget: WorldVec3 | null;
  animState: AvatarAnimState;
  operationalMode: EmployeeLiveStatus | "meeting";
  activeToolName: string | null;
  targetKey: string;
  targetKind: "desk" | "meeting_seat" | "lounge";
  targetPos: WorldVec3;
  targetYaw: number;
  path: WorldVec3[];
  pathIndex: number;
  walkSpeed: number;
  currentSpeed: number;
  loungeSpotId: string | null;
  loungeDwellRemaining: number;
  ambientCooldown: number;
  rngState: number;
}

export interface BehaviorStepOptions {
  ambientMode: AmbientLifeMode;
  reducedMotion: boolean;
  meetings: MeetingRecord[];
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function nextRand(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const val = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [val, (state + 0x9e3779b9) >>> 0];
}

function normalizeAngleDiff(target: number, current: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function createInitialAgentStates(
  employees: LoadedEmployee[],
  floorplan: OfficeFloorplan,
): Record<string, AvatarAgentState> {
  const out: Record<string, AvatarAgentState> = {};
  for (let i = 0; i < employees.length; i += 1) {
    const emp = employees[i]!;
    const desk =
      floorplan.desks.find((d) => d.employeeId === emp.profile.id) ??
      floorplan.desks.find((d) => d.id === emp.profile.deskId) ??
      floorplan.desks[i];
    const pose = desk
      ? getDeskPoseWorld(desk, floorplan)
      : {
          deskId: emp.profile.deskId,
          seatPos: { x: 0, y: 0, z: 0 },
          approachPos: { x: 0, y: 0, z: 0.4 },
          monitorPos: { x: 0, y: 1.05, z: -0.6 },
          yaw: Math.PI,
        };
    const seed = hashSeed(emp.profile.id);
    const [r, nextSeed] = nextRand(seed);
    out[emp.profile.id] = {
      employeeId: emp.profile.id,
      deskId: desk?.id ?? emp.profile.deskId,
      position: { ...pose.seatPos },
      yaw: pose.yaw,
      lookAtTarget: pose.monitorPos,
      animState: "SeatedIdle",
      operationalMode: "idle",
      activeToolName: null,
      targetKind: "desk",
      targetKey: `desk:${pose.deskId}:idle`,
      targetPos: { ...pose.seatPos },
      targetYaw: pose.yaw,
      path: [],
      pathIndex: 0,
      walkSpeed: 1.8,
      currentSpeed: 0,
      loungeSpotId: null,
      loungeDwellRemaining: 0,
      ambientCooldown: 18 + r * 35,
      rngState: nextSeed,
    };
  }
  return out;
}

function resolveActiveMeeting(meetings: MeetingRecord[]): {
  meeting: MeetingRecord;
  seatByEmployee: Map<string, number>;
  activeSpeakerId: string;
} | null {
  const running = meetings.find((m) => m.status === "RUNNING");
  if (!running) return null;
  const participants = Array.from(
    new Set([running.facilitatorEmployeeId, ...running.participantEmployeeIds]),
  ).slice(0, 6);
  const seatByEmployee = new Map<string, number>();
  participants.forEach((empId, idx) => seatByEmployee.set(empId, idx));
  const lastTurn = running.turns[running.turns.length - 1];
  const activeSpeakerId = lastTurn?.employeeId ?? running.facilitatorEmployeeId;
  return { meeting: running, seatByEmployee, activeSpeakerId };
}

/**
 * Pure hierarchical state machine + ambient life + A* steering step.
 * Enforces Instant Preemption: operational transitions (`working`, `waiting_approval`,
 * `meeting`) immediately cancel any `AmbientLounge` stroll without delay.
 */
export function stepBehaviorSystem(
  agents: Record<string, AvatarAgentState>,
  inputs: EmployeeBehaviorInput[],
  navGrid: OfficeNavGrid,
  floorplan: OfficeFloorplan,
  dtSeconds: number,
  options: BehaviorStepOptions,
): void {
  const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
  const meetingCtx = resolveActiveMeeting(options.meetings);
  const meetingSeats = getMeetingSeatsWorld(floorplan);
  const meetingTable = getMeetingTableWorld(floorplan);
  const loungeSpots = getLoungeSpotsWorld(floorplan);

  const allowAmbient = !options.reducedMotion && options.ambientMode !== "quiet";
  const maxAmbientRoamers = options.ambientMode === "lively" ? 3 : 2;
  let currentAmbientCount = 0;
  const occupiedLoungeIds = new Set<string>();
  for (const inp of inputs) {
    const ag = agents[inp.employeeId];
    if (ag && ag.targetKind === "lounge") {
      currentAmbientCount += 1;
      if (ag.loungeSpotId) occupiedLoungeIds.add(ag.loungeSpotId);
    }
  }

  for (const inp of inputs) {
    const agent = agents[inp.employeeId];
    if (!agent) continue;

    const desk =
      floorplan.desks.find((d) => d.employeeId === inp.employeeId) ??
      floorplan.desks.find((d) => d.id === inp.deskId) ??
      floorplan.desks[0];
    if (!desk) continue;

    const deskPose = getDeskPoseWorld(desk, floorplan);
    agent.activeToolName = inp.activeToolName;

    const inMeetingSeat =
      meetingCtx !== null && inp.liveStatus !== "waiting_approval"
        ? meetingCtx.seatByEmployee.get(inp.employeeId)
        : undefined;

    let desiredKind: "desk" | "meeting_seat" | "lounge" = "desk";
    let desiredKey = `desk:${desk.id}:${inp.liveStatus}`;
    let desiredPos: WorldVec3 = deskPose.seatPos;
    let desiredYaw = deskPose.yaw;
    let desiredLookAt: WorldVec3 | null = deskPose.monitorPos;
    let settledAnim: AvatarAnimState = "SeatedIdle";
    let walkSpeed = 1.9;
    let opMode: EmployeeLiveStatus | "meeting" = inp.liveStatus;

    // Layer 1: Operational Truth (Strict priority + Instant Preemption)
    if (inp.liveStatus === "waiting_approval") {
      desiredKind = "desk";
      desiredKey = `desk:${desk.id}:approval`;
      desiredPos = deskPose.approachPos;
      desiredYaw = deskPose.yaw;
      desiredLookAt = null;
      settledAnim = "HandRaiseApproval";
      walkSpeed = 2.35;
      opMode = "waiting_approval";
    } else if (inMeetingSeat !== undefined && meetingCtx) {
      const seat = meetingSeats[inMeetingSeat % meetingSeats.length]!;
      const isSpeaker = meetingCtx.activeSpeakerId === inp.employeeId;
      desiredKind = "meeting_seat";
      desiredKey = `meeting:${meetingCtx.meeting.id}:seat:${seat.seatIndex}`;
      desiredPos = seat.seatPos;
      desiredYaw = seat.lookAtYaw;
      const speakerSeatIdx = meetingCtx.seatByEmployee.get(meetingCtx.activeSpeakerId);
      const speakerSeat =
        speakerSeatIdx !== undefined ? meetingSeats[speakerSeatIdx % meetingSeats.length] : undefined;
      desiredLookAt = !isSpeaker && speakerSeat ? speakerSeat.seatPos : meetingTable.center;
      settledAnim = isSpeaker ? "MeetingTalking" : "MeetingSeated";
      walkSpeed = 1.7;
      opMode = "meeting";
    } else if (inp.liveStatus === "working" || inp.liveStatus === "queued") {
      desiredKind = "desk";
      desiredKey = `desk:${desk.id}:work`;
      desiredPos = deskPose.seatPos;
      desiredYaw = deskPose.yaw;
      desiredLookAt = deskPose.monitorPos;
      settledAnim = "TypingActive";
      walkSpeed = 2.2;
      opMode = inp.liveStatus;
    } else if (inp.liveStatus === "failed") {
      desiredKind = "desk";
      desiredKey = `desk:${desk.id}:failed`;
      desiredPos = deskPose.seatPos;
      desiredYaw = deskPose.yaw;
      desiredLookAt = deskPose.monitorPos;
      settledAnim = "AlertFailed";
      walkSpeed = 1.9;
      opMode = "failed";
    } else {
      // Layer 2: IDLE — check Ambient Life eligibility
      opMode = "idle";
      if (!allowAmbient) {
        agent.loungeSpotId = null;
        agent.loungeDwellRemaining = 0;
        desiredKind = "desk";
        desiredKey = `desk:${desk.id}:idle`;
        desiredPos = deskPose.seatPos;
        desiredYaw = deskPose.yaw;
        desiredLookAt = deskPose.monitorPos;
        settledAnim = "SeatedIdle";
      } else if (agent.targetKind === "lounge" && agent.loungeSpotId) {
        const currentSpot = loungeSpots.find((s) => s.id === agent.loungeSpotId);
        if (currentSpot && agent.loungeDwellRemaining > 0) {
          desiredKind = "lounge";
          desiredKey = `lounge:${currentSpot.id}`;
          desiredPos = currentSpot.standPos;
          desiredYaw = currentSpot.lookYaw;
          desiredLookAt = null;
          settledAnim = "AmbientLounge";
          walkSpeed = 1.25;
        } else {
          // Finished dwelling -> return cleanly to desk
          occupiedLoungeIds.delete(agent.loungeSpotId);
          agent.loungeSpotId = null;
          const [rCooldown, s1] = nextRand(agent.rngState);
          agent.rngState = s1;
          agent.ambientCooldown =
            options.ambientMode === "lively" ? 18 + rCooldown * 17 : 45 + rCooldown * 30;
          desiredKind = "desk";
          desiredKey = `desk:${desk.id}:idle`;
          desiredPos = deskPose.seatPos;
          desiredYaw = deskPose.yaw;
          desiredLookAt = deskPose.monitorPos;
          settledAnim = "SeatedIdle";
          walkSpeed = 1.3;
        }
      } else {
        // Seated idle at desk -> count down ambient trigger
        desiredKind = "desk";
        desiredKey = `desk:${desk.id}:idle`;
        desiredPos = deskPose.seatPos;
        desiredYaw = deskPose.yaw;
        desiredLookAt = deskPose.monitorPos;
        settledAnim = "SeatedIdle";
        walkSpeed = 1.35;

        if (agent.path.length === 0 && dist2D(agent.position, deskPose.seatPos) < 0.22) {
          agent.ambientCooldown -= dt;
          if (agent.ambientCooldown <= 0 && currentAmbientCount < maxAmbientRoamers) {
            const freeSpots = loungeSpots.filter((s) => !occupiedLoungeIds.has(s.id));
            if (freeSpots.length > 0) {
              const [rPick, s1] = nextRand(agent.rngState);
              const [rDwell, s2] = nextRand(s1);
              agent.rngState = s2;
              const spot = freeSpots[Math.floor(rPick * freeSpots.length) % freeSpots.length]!;
              occupiedLoungeIds.add(spot.id);
              currentAmbientCount += 1;
              agent.loungeSpotId = spot.id;
              agent.loungeDwellRemaining = 14 + rDwell * 10;
              desiredKind = "lounge";
              desiredKey = `lounge:${spot.id}`;
              desiredPos = spot.standPos;
              desiredYaw = spot.lookYaw;
              desiredLookAt = null;
              settledAnim = "AmbientLounge";
              walkSpeed = 1.25;
            }
          }
        }
      }
    }

    // Clear lounge reservation immediately if preempted by any operational transition
    if (desiredKind !== "lounge" && agent.loungeSpotId) {
      occupiedLoungeIds.delete(agent.loungeSpotId);
      agent.loungeSpotId = null;
      agent.loungeDwellRemaining = 0;
    }

    agent.operationalMode = opMode;
    agent.targetKind = desiredKind;
    agent.walkSpeed = walkSpeed;
    agent.lookAtTarget = desiredLookAt;

    // Recompute A* path cleanly whenever target changes
    if (agent.targetKey !== desiredKey || dist2D(agent.targetPos, desiredPos) > 0.25) {
      agent.targetKey = desiredKey;
      agent.targetPos = { ...desiredPos };
      agent.targetYaw = desiredYaw;
      if (dist2D(agent.position, desiredPos) > 0.14) {
        const computed = findPath(navGrid, agent.position, desiredPos);
        agent.path = computed.length > 0 ? [...computed, { ...desiredPos }] : [{ ...desiredPos }];
        agent.pathIndex = 0;
      } else {
        agent.path = [];
        agent.pathIndex = 0;
      }
    } else {
      agent.targetYaw = desiredYaw;
    }

    // Advance along active waypoints
    if (agent.path.length > 0 && agent.pathIndex < agent.path.length) {
      const wp = agent.path[agent.pathIndex]!;
      const dx = wp.x - agent.position.x;
      const dz = wp.z - agent.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.08) {
        agent.position.x = wp.x;
        agent.position.z = wp.z;
        agent.pathIndex += 1;
        if (agent.pathIndex >= agent.path.length) {
          agent.path = [];
          agent.pathIndex = 0;
          agent.currentSpeed = 0;
          agent.animState = settledAnim;
        }
      } else {
        const stepDist = Math.min(dist, walkSpeed * dt);
        const dirX = dx / dist;
        const dirZ = dz / dist;
        agent.position.x += dirX * stepDist;
        agent.position.z += dirZ * stepDist;
        agent.currentSpeed = walkSpeed;
        agent.animState = "Walking";

        const moveYaw = Math.atan2(dirX, dirZ);
        const yawDelta = normalizeAngleDiff(moveYaw, agent.yaw);
        agent.yaw += yawDelta * Math.min(1, dt * 10);
      }
    } else {
      // Settled at target
      agent.currentSpeed = 0;
      const yawDelta = normalizeAngleDiff(agent.targetYaw, agent.yaw);
      agent.yaw += yawDelta * Math.min(1, dt * 8);
      agent.animState = settledAnim;
      if (desiredKind === "lounge" && agent.loungeDwellRemaining > 0) {
        agent.loungeDwellRemaining = Math.max(0, agent.loungeDwellRemaining - dt);
      }
    }
  }
}
