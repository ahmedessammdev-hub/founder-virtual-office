import type { FloorplanZone, OfficeFloorplan } from "@virtual-office/shared";
import {
  PX_PER_METER,
  getDeskPoseWorld,
  getMeetingTableWorld,
  type WorldVec3,
} from "./coordinates.ts";

export interface PartitionSegmentWorld {
  zoneId: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  hasDoor: boolean;
}

export interface OfficeNavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originZ: number;
  widthM: number;
  heightM: number;
  walkable: Uint8Array;
  partitionSegments: PartitionSegmentWorld[];
}

function splitWallWithDoor(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  doorWidth = 1.4,
): Array<{ x1: number; z1: number; x2: number; z2: number }> {
  const len = Math.hypot(x2 - x1, z2 - z1);
  if (len <= doorWidth + 0.4) {
    return [];
  }
  const midT = 0.5;
  const halfGapT = Math.min(0.45, doorWidth / (2 * len));
  const tA = Math.max(0.05, midT - halfGapT);
  const tB = Math.min(0.95, midT + halfGapT);
  return [
    {
      x1,
      z1,
      x2: x1 + (x2 - x1) * tA,
      z2: z1 + (z2 - z1) * tA,
    },
    {
      x1: x1 + (x2 - x1) * tB,
      z1: z1 + (z2 - z1) * tB,
      x2,
      z2,
    },
  ];
}

/**
 * Generates shared partition wall segments (including 1.4m doorway openings facing the central studio
 * workspace) used identically by `navgrid.ts` collision rasterization and `ArchitecturalRoom.tsx`.
 */
export function getRoomPartitionSegments(floorplan: OfficeFloorplan): PartitionSegmentWorld[] {
  const segments: PartitionSegmentWorld[] = [];
  const halfW = floorplan.width / (2 * PX_PER_METER);
  const halfH = floorplan.height / (2 * PX_PER_METER);

  const workZone = floorplan.zones.find((z) => z.kind === "workstations");
  const targetCenter = workZone
    ? {
        x: (workZone.x + workZone.width / 2 - floorplan.width / 2) / PX_PER_METER,
        z: (workZone.y + workZone.height / 2 - floorplan.height / 2) / PX_PER_METER,
      }
    : { x: 0, z: 0 };

  for (const zone of floorplan.zones) {
    if (zone.kind !== "manager_office" && zone.kind !== "meeting_room") continue;

    const xMin = zone.x / PX_PER_METER - halfW;
    const xMax = (zone.x + zone.width) / PX_PER_METER - halfW;
    const zMin = zone.y / PX_PER_METER - halfH;
    const zMax = (zone.y + zone.height) / PX_PER_METER - halfH;
    const cx = (xMin + xMax) / 2;
    const cz = (zMin + zMax) / 2;

    const edges: Array<{
      id: "north" | "south" | "east" | "west";
      x1: number;
      z1: number;
      x2: number;
      z2: number;
      nx: number;
      nz: number;
      mx: number;
      mz: number;
    }> = [
      { id: "north", x1: xMin, z1: zMin, x2: xMax, z2: zMin, nx: 0, nz: -1, mx: cx, mz: zMin },
      { id: "south", x1: xMin, z1: zMax, x2: xMax, z2: zMax, nx: 0, nz: 1, mx: cx, mz: zMax },
      { id: "east", x1: xMax, z1: zMin, x2: xMax, z2: zMax, nx: 1, nz: 0, mx: xMax, mz: cz },
      { id: "west", x1: xMin, z1: zMin, x2: xMin, z2: zMax, nx: -1, nz: 0, mx: xMin, mz: cz },
    ];

    // Pick interior wall (not touching room outer border) whose normal best faces workstations/center
    const interiorEdges = edges.filter((e) => {
      if (e.id === "north" && Math.abs(e.z1 + halfH) < 0.55) return false;
      if (e.id === "south" && Math.abs(halfH - e.z1) < 0.55) return false;
      if (e.id === "west" && Math.abs(e.x1 + halfW) < 0.55) return false;
      if (e.id === "east" && Math.abs(halfW - e.x1) < 0.55) return false;
      return true;
    });

    let doorEdgeId: string | null = null;
    let bestScore = -Infinity;
    for (const e of interiorEdges) {
      const toWorkX = targetCenter.x - e.mx;
      const toWorkZ = targetCenter.z - e.mz;
      const dot = toWorkX * e.nx + toWorkZ * e.nz;
      if (dot > bestScore) {
        bestScore = dot;
        doorEdgeId = e.id;
      }
    }
    if (!doorEdgeId && interiorEdges[0]) {
      doorEdgeId = interiorEdges[0].id;
    }

    for (const e of edges) {
      if (e.id === doorEdgeId) {
        const split = splitWallWithDoor(e.x1, e.z1, e.x2, e.z2, 1.6);
        for (const piece of split) {
          segments.push({ zoneId: zone.id, ...piece, hasDoor: true });
        }
      } else {
        segments.push({ zoneId: zone.id, x1: e.x1, z1: e.z1, x2: e.x2, z2: e.z2, hasDoor: false });
      }
    }
  }

  return segments;
}

function getZoneBox(zone: FloorplanZone, floorplan: OfficeFloorplan) {
  const halfW = floorplan.width / (2 * PX_PER_METER);
  const halfH = floorplan.height / (2 * PX_PER_METER);
  return {
    xMin: zone.x / PX_PER_METER - halfW,
    xMax: (zone.x + zone.width) / PX_PER_METER - halfW,
    zMin: zone.y / PX_PER_METER - halfH,
    zMax: (zone.y + zone.height) / PX_PER_METER - halfH,
  };
}

export function buildOfficeNavGrid(
  floorplan: OfficeFloorplan,
  cellSize = 0.25,
): OfficeNavGrid {
  const widthM = floorplan.width / PX_PER_METER;
  const heightM = floorplan.height / PX_PER_METER;
  const cols = Math.max(8, Math.ceil(widthM / cellSize));
  const rows = Math.max(8, Math.ceil(heightM / cellSize));
  const originX = -widthM / 2;
  const originZ = -heightM / 2;
  const walkable = new Uint8Array(cols * rows).fill(1);

  const idx = (c: number, r: number) => r * cols + c;
  const cellCenter = (c: number, r: number) => ({
    x: originX + (c + 0.5) * cellSize,
    z: originZ + (r + 0.5) * cellSize,
  });

  const blockRect = (xMin: number, zMin: number, xMax: number, zMax: number, margin = 0.08) => {
    const c0 = Math.max(0, Math.floor((xMin - margin - originX) / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((xMax + margin - originX) / cellSize));
    const r0 = Math.max(0, Math.floor((zMin - margin - originZ) / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((zMax + margin - originZ) / cellSize));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        walkable[idx(c, r)] = 0;
      }
    }
  };

  // Outer perimeter walls (border cells)
  for (let c = 0; c < cols; c += 1) {
    walkable[idx(c, 0)] = 0;
    walkable[idx(c, rows - 1)] = 0;
  }
  for (let r = 0; r < rows; r += 1) {
    walkable[idx(0, r)] = 0;
    walkable[idx(cols - 1, r)] = 0;
  }

  // Room glass partition walls (respecting carved doorway gaps)
  const partitionSegments = getRoomPartitionSegments(floorplan);
  for (const seg of partitionSegments) {
    const xMin = Math.min(seg.x1, seg.x2);
    const xMax = Math.max(seg.x1, seg.x2);
    const zMin = Math.min(seg.z1, seg.z2);
    const zMax = Math.max(seg.z1, seg.z2);
    blockRect(xMin, zMin, xMax, zMax, 0.05);
  }

  // Desks footprint (excluding chair/approach area so employees can sit smoothly)
  for (const desk of floorplan.desks) {
    const pose = getDeskPoseWorld(desk, floorplan);
    blockRect(
      pose.center.x - pose.halfWidth,
      pose.center.z - pose.halfDepth,
      pose.center.x + pose.halfWidth,
      pose.center.z + pose.halfDepth,
      0.03,
    );
  }

  // Meeting room oval table center obstacle
  const table = getMeetingTableWorld(floorplan);
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      const pt = cellCenter(c, r);
      const nx = (pt.x - table.center.x) / (table.rx * 0.92);
      const nz = (pt.z - table.center.z) / (table.rz * 0.92);
      if (nx * nx + nz * nz <= 1) {
        walkable[idx(c, r)] = 0;
      }
    }
  }

  // Lounge sofa & coffee bar blocks (compact inside lounge zone)
  const lounge = floorplan.zones.find((z) => z.kind === "lounge");
  if (lounge) {
    const box = getZoneBox(lounge, floorplan);
    const zw = box.xMax - box.xMin;
    const zh = box.zMax - box.zMin;
    // Sofa along southern half-west
    blockRect(box.xMin + zw * 0.14, box.zMin + zh * 0.62, box.xMin + zw * 0.44, box.zMin + zh * 0.88, 0.04);
    // Coffee bar counter along northern half-east
    blockRect(box.xMin + zw * 0.66, box.zMin + zh * 0.14, box.xMin + zw * 0.90, box.zMin + zh * 0.36, 0.04);
  }

  return {
    cols,
    rows,
    cellSize,
    originX,
    originZ,
    widthM,
    heightM,
    walkable,
    partitionSegments,
  };
}

export function worldToCell(grid: OfficeNavGrid, x: number, z: number): { c: number; r: number } {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.originX) / grid.cellSize)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor((z - grid.originZ) / grid.cellSize)));
  return { c, r };
}

export function cellToWorld(grid: OfficeNavGrid, c: number, r: number): WorldVec3 {
  return {
    x: grid.originX + (c + 0.5) * grid.cellSize,
    y: 0,
    z: grid.originZ + (r + 0.5) * grid.cellSize,
  };
}

export function isCellWalkable(grid: OfficeNavGrid, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
  return grid.walkable[r * grid.cols + c] === 1;
}

export function isWorldWalkable(grid: OfficeNavGrid, x: number, z: number): boolean {
  const { c, r } = worldToCell(grid, x, z);
  return isCellWalkable(grid, c, r);
}

function findNearestWalkableCell(
  grid: OfficeNavGrid,
  startC: number,
  startR: number,
): { c: number; r: number } | null {
  if (isCellWalkable(grid, startC, startR)) return { c: startC, r: startR };
  const visited = new Uint8Array(grid.cols * grid.rows);
  const queue: Array<{ c: number; r: number; d: number }> = [{ c: startC, r: startR, d: 0 }];
  visited[startR * grid.cols + startC] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.d > 8) break;
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      const k = nr * grid.cols + nc;
      if (visited[k]) continue;
      visited[k] = 1;
      if (isCellWalkable(grid, nc, nr)) return { c: nc, r: nr };
      queue.push({ c: nc, r: nr, d: cur.d + 1 });
    }
  }
  return null;
}

export function hasLineOfSight(grid: OfficeNavGrid, a: WorldVec3, b: WorldVec3): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(dist / (grid.cellSize * 0.35)));
  const radius = Math.min(0.14, grid.cellSize * 0.3);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    if (
      !isWorldWalkable(grid, px, pz) ||
      !isWorldWalkable(grid, px + radius, pz) ||
      !isWorldWalkable(grid, px - radius, pz) ||
      !isWorldWalkable(grid, px, pz + radius) ||
      !isWorldWalkable(grid, px, pz - radius)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Computes an A* path across the studio floorplan with anti-corner-cutting and
 * string-pulling line-of-sight smoothing. Never emits waypoints inside blocked cells.
 */
export function findPath(
  grid: OfficeNavGrid,
  start: WorldVec3,
  goal: WorldVec3,
): WorldVec3[] {
  const sRaw = worldToCell(grid, start.x, start.z);
  const gRaw = worldToCell(grid, goal.x, goal.z);
  const s = findNearestWalkableCell(grid, sRaw.c, sRaw.r);
  const g = findNearestWalkableCell(grid, gRaw.c, gRaw.r);
  if (!s || !g) return [];

  if (s.c === g.c && s.r === g.r) {
    return isWorldWalkable(grid, goal.x, goal.z)
      ? [{ x: goal.x, y: 0, z: goal.z }]
      : [cellToWorld(grid, g.c, g.r)];
  }

  const total = grid.cols * grid.rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);

  const key = (c: number, r: number) => r * grid.cols + c;
  const heuristic = (c: number, r: number) => {
    const dx = Math.abs(c - g.c);
    const dr = Math.abs(r - g.r);
    return Math.max(dx, dr) + (Math.SQRT2 - 1) * Math.min(dx, dr);
  };

  const sKey = key(s.c, s.r);
  const gKey = key(g.c, g.r);
  gScore[sKey] = 0;
  fScore[sKey] = heuristic(s.c, s.r);
  const open: number[] = [sKey];
  inOpen[sKey] = 1;

  const neighbors = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;

  let found = false;
  while (open.length > 0) {
    let bestIdx = 0;
    let bestF = fScore[open[0]!] ?? Infinity;
    for (let i = 1; i < open.length; i += 1) {
      const candidateF = fScore[open[i]!] ?? Infinity;
      if (candidateF < bestF) {
        bestF = candidateF;
        bestIdx = i;
      }
    }

    const curKey = open.splice(bestIdx, 1)[0]!;
    inOpen[curKey] = 0;
    if (curKey === gKey) {
      found = true;
      break;
    }
    closed[curKey] = 1;

    const cc = curKey % grid.cols;
    const cr = Math.floor(curKey / grid.cols);

    for (const [dc, dr, stepCost] of neighbors) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isCellWalkable(grid, nc, nr)) continue;
      // Strict anti-corner-cutting on diagonals
      if (dc !== 0 && dr !== 0) {
        if (!isCellWalkable(grid, cc + dc, cr) || !isCellWalkable(grid, cc, cr + dr)) {
          continue;
        }
      }
      const nKey = key(nc, nr);
      if (closed[nKey]) continue;
      const tentative = (gScore[curKey] ?? Infinity) + stepCost;
      if (tentative < (gScore[nKey] ?? Infinity)) {
        parent[nKey] = curKey;
        gScore[nKey] = tentative;
        fScore[nKey] = tentative + heuristic(nc, nr);
        if (!inOpen[nKey]) {
          open.push(nKey);
          inOpen[nKey] = 1;
        }
      }
    }
  }

  if (!found) return [];

  const rawPoints: WorldVec3[] = [];
  let trace = gKey;
  while (trace !== -1) {
    const tc = trace % grid.cols;
    const tr = Math.floor(trace / grid.cols);
    rawPoints.push(cellToWorld(grid, tc, tr));
    if (trace === sKey) break;
    trace = parent[trace]!;
  }
  rawPoints.reverse();

  // Replace end with exact walkable goal if unobstructed
  const finalGoal = isWorldWalkable(grid, goal.x, goal.z)
    ? { x: goal.x, y: 0, z: goal.z }
    : cellToWorld(grid, g.c, g.r);
  if (rawPoints.length > 0) {
    rawPoints[rawPoints.length - 1] = finalGoal;
  }

  // String-pulling LoS smoothing
  const smoothed: WorldVec3[] = [];
  let anchor = isWorldWalkable(grid, start.x, start.z)
    ? { x: start.x, y: 0, z: start.z }
    : cellToWorld(grid, s.c, s.r);
  let i = 0;
  while (i < rawPoints.length) {
    let furthest = i;
    for (let j = rawPoints.length - 1; j > i; j -= 1) {
      if (hasLineOfSight(grid, anchor, rawPoints[j]!)) {
        furthest = j;
        break;
      }
    }
    const chosen = rawPoints[furthest]!;
    smoothed.push(chosen);
    anchor = chosen;
    i = furthest + 1;
  }

  return smoothed;
}

/**
 * Collision clamp for First-Person (`WASD`) exploration so the camera slides along walls
 * and obstacles instead of penetrating them.
 */
export function clampWalkablePosition(
  grid: OfficeNavGrid,
  from: WorldVec3,
  to: WorldVec3,
  margin = 0.22,
): WorldVec3 {
  const canStand = (x: number, z: number) =>
    isWorldWalkable(grid, x, z) &&
    isWorldWalkable(grid, x + margin, z) &&
    isWorldWalkable(grid, x - margin, z) &&
    isWorldWalkable(grid, x, z + margin) &&
    isWorldWalkable(grid, x, z - margin);

  if (canStand(to.x, to.z)) {
    return { x: to.x, y: to.y, z: to.z };
  }
  if (canStand(to.x, from.z)) {
    return { x: to.x, y: to.y, z: from.z };
  }
  if (canStand(from.x, to.z)) {
    return { x: from.x, y: to.y, z: to.z };
  }
  return { x: from.x, y: to.y, z: from.z };
}
