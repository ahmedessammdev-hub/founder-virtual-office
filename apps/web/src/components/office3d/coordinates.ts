import type { FloorplanDesk, OfficeFloorplan } from "@virtual-office/shared";

export const PX_PER_METER = 100;

export interface WorldVec3 {
  x: number;
  y: number;
  z: number;
}

export interface DeskPoseWorld {
  deskId: string;
  employeeId?: string;
  rotationDeg: 0 | 90 | 180 | 270;
  yaw: number;
  center: WorldVec3;
  seatPos: WorldVec3;
  approachPos: WorldVec3;
  monitorPos: WorldVec3;
  halfWidth: number;
  halfDepth: number;
}

export interface MeetingTableWorld {
  center: WorldVec3;
  rx: number;
  rz: number;
}

export interface MeetingSeatWorld {
  seatIndex: number;
  seatPos: WorldVec3;
  approachPos: WorldVec3;
  lookAtYaw: number;
}

export interface LoungeSpotWorld {
  id: string;
  kind: "sofa" | "coffee";
  standPos: WorldVec3;
  lookYaw: number;
}

export function pxToWorld(
  px: number,
  py: number,
  floorplan: Pick<OfficeFloorplan, "width" | "height">,
  y = 0,
): WorldVec3 {
  return {
    x: (px - floorplan.width / 2) / PX_PER_METER,
    y,
    z: (py - floorplan.height / 2) / PX_PER_METER,
  };
}

export function worldToPx(
  x: number,
  z: number,
  floorplan: Pick<OfficeFloorplan, "width" | "height">,
): { px: number; py: number } {
  return {
    px: x * PX_PER_METER + floorplan.width / 2,
    py: z * PX_PER_METER + floorplan.height / 2,
  };
}

export function dist2D(a: Pick<WorldVec3, "x" | "z">, b: Pick<WorldVec3, "x" | "z">): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function getDeskPoseWorld(
  desk: FloorplanDesk,
  floorplan: Pick<OfficeFloorplan, "width" | "height">,
): DeskPoseWorld {
  const rot = (desk.rotationDeg ?? 0) as 0 | 90 | 180 | 270;
  // Matches 2D center of SVG desk card (desk.x + 96, desk.y + 52)
  const center = pxToWorld(desk.x + 96, desk.y + 52, floorplan, 0);

  // Forward direction vector in XZ pointing from employee toward monitors:
  // 0 deg   -> monitors at -Z, employee sits +Z facing -Z (yaw = PI)
  // 90 deg  -> monitors at +X, employee sits -X facing +X (yaw = +PI/2)
  // 180 deg -> monitors at +Z, employee sits -Z facing +Z (yaw = 0)
  // 270 deg -> monitors at -X, employee sits +X facing -X (yaw = -PI/2)
  let fwdX = 0;
  let fwdZ = -1;
  let yaw = Math.PI;
  let halfWidth = 0.78;
  let halfDepth = 0.39;

  if (rot === 90) {
    fwdX = 1;
    fwdZ = 0;
    yaw = Math.PI / 2;
    halfWidth = 0.39;
    halfDepth = 0.78;
  } else if (rot === 180) {
    fwdX = 0;
    fwdZ = 1;
    yaw = 0;
    halfWidth = 0.78;
    halfDepth = 0.39;
  } else if (rot === 270) {
    fwdX = -1;
    fwdZ = 0;
    yaw = -Math.PI / 2;
    halfWidth = 0.39;
    halfDepth = 0.78;
  }

  const seatPos: WorldVec3 = {
    x: center.x - fwdX * 0.62,
    y: 0,
    z: center.z - fwdZ * 0.62,
  };
  const approachPos: WorldVec3 = {
    x: center.x - fwdX * 0.96,
    y: 0,
    z: center.z - fwdZ * 0.96,
  };
  const monitorPos: WorldVec3 = {
    x: center.x + fwdX * 0.18,
    y: 1.05,
    z: center.z + fwdZ * 0.18,
  };

  return {
    deskId: desk.id,
    employeeId: desk.employeeId,
    rotationDeg: rot,
    yaw,
    center,
    seatPos,
    approachPos,
    monitorPos,
    halfWidth,
    halfDepth,
  };
}

export function getMeetingTableWorld(floorplan: OfficeFloorplan): MeetingTableWorld {
  const zone = floorplan.zones.find((z) => z.kind === "meeting_room");
  if (!zone) {
    return {
      center: { x: -3.9, y: 0, z: 1.6 },
      rx: 0.85,
      rz: 1.0,
    };
  }
  const center = pxToWorld(zone.x + zone.width / 2, zone.y + zone.height / 2, floorplan, 0);
  const zoneW = zone.width / PX_PER_METER;
  const zoneH = zone.height / PX_PER_METER;
  return {
    center,
    rx: Math.min(0.82, Math.max(0.55, zoneW * 0.24)),
    rz: Math.min(1.05, Math.max(0.65, zoneH * 0.28)),
  };
}

export function getMeetingSeatsWorld(floorplan: OfficeFloorplan): MeetingSeatWorld[] {
  const table = getMeetingTableWorld(floorplan);
  const angles = [
    0,
    Math.PI / 3,
    (2 * Math.PI) / 3,
    Math.PI,
    (4 * Math.PI) / 3,
    (5 * Math.PI) / 3,
  ];
  return angles.map((theta, seatIndex) => {
    const sx = table.center.x + Math.sin(theta) * (table.rx + 0.42);
    const sz = table.center.z + Math.cos(theta) * (table.rz + 0.42);
    const ax = table.center.x + Math.sin(theta) * (table.rx + 0.72);
    const az = table.center.z + Math.cos(theta) * (table.rz + 0.72);
    const lookAtYaw = Math.atan2(table.center.x - sx, table.center.z - sz);
    return {
      seatIndex,
      seatPos: { x: sx, y: 0, z: sz },
      approachPos: { x: ax, y: 0, z: az },
      lookAtYaw,
    };
  });
}

export function getLoungeSpotsWorld(floorplan: OfficeFloorplan): LoungeSpotWorld[] {
  const lounge = floorplan.zones.find((z) => z.kind === "lounge");
  if (!lounge) {
    return [
      { id: "lounge-1", kind: "sofa", standPos: { x: 0.6, y: 0, z: 2.2 }, lookYaw: Math.PI },
      { id: "lounge-2", kind: "sofa", standPos: { x: 1.5, y: 0, z: 2.2 }, lookYaw: Math.PI },
      { id: "lounge-3", kind: "coffee", standPos: { x: 3.1, y: 0, z: 2.1 }, lookYaw: 0 },
      { id: "lounge-4", kind: "coffee", standPos: { x: 4.1, y: 0, z: 2.1 }, lookYaw: 0 },
    ];
  }

  const left = (lounge.x - floorplan.width / 2) / PX_PER_METER;
  const top = (lounge.y - floorplan.height / 2) / PX_PER_METER;
  const w = lounge.width / PX_PER_METER;
  const h = lounge.height / PX_PER_METER;
  const midZ = top + h * 0.48;

  return [
    {
      id: "lounge-sofa-left",
      kind: "sofa",
      standPos: { x: left + w * 0.22, y: 0, z: midZ + 0.35 },
      lookYaw: Math.PI,
    },
    {
      id: "lounge-sofa-right",
      kind: "sofa",
      standPos: { x: left + w * 0.38, y: 0, z: midZ + 0.35 },
      lookYaw: Math.PI,
    },
    {
      id: "lounge-coffee-west",
      kind: "coffee",
      standPos: { x: left + w * 0.68, y: 0, z: midZ - 0.1 },
      lookYaw: Math.PI / 2,
    },
    {
      id: "lounge-coffee-east",
      kind: "coffee",
      standPos: { x: left + w * 0.84, y: 0, z: midZ + 0.2 },
      lookYaw: -Math.PI / 2,
    },
  ];
}
