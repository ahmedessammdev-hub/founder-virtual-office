import { describe, expect, it } from "vitest";
import type { OfficeFloorplan } from "@virtual-office/shared";
import { getDeskPoseWorld, getMeetingSeatsWorld } from "../src/components/office3d/coordinates.ts";
import {
  buildOfficeNavGrid,
  clampWalkablePosition,
  findPath,
  isWorldWalkable,
} from "../src/components/office3d/navgrid.ts";

const SAMPLE_FLOORPLAN: OfficeFloorplan = {
  width: 1200,
  height: 760,
  theme: "sunlit_studio",
  zones: [
    {
      id: "manager-office",
      name: "Executive Office",
      nameAr: "مكتب الإدارة",
      kind: "manager_office",
      x: 40,
      y: 40,
      width: 340,
      height: 280,
    },
    {
      id: "meeting-room",
      name: "Board & Meeting Room",
      nameAr: "غرفة الاجتماعات",
      kind: "meeting_room",
      x: 40,
      y: 360,
      width: 340,
      height: 360,
    },
    {
      id: "workstations",
      name: "Open Workstations",
      nameAr: "منطقة فرق العمل",
      kind: "workstations",
      x: 420,
      y: 40,
      width: 740,
      height: 440,
    },
    {
      id: "lounge",
      name: "Lounge & Sync",
      nameAr: "منطقة الاستراحة",
      kind: "lounge",
      x: 420,
      y: 520,
      width: 740,
      height: 200,
    },
  ],
  desks: [
    { id: "desk-gm", zoneId: "manager-office", x: 160, y: 140, employeeId: "general-manager", rotationDeg: 0 },
    { id: "desk-hr", zoneId: "workstations", x: 500, y: 130, employeeId: "hr-talent", rotationDeg: 0 },
    { id: "desk-eng", zoneId: "workstations", x: 760, y: 130, employeeId: "senior-engineer", rotationDeg: 0 },
    { id: "desk-product", zoneId: "workstations", x: 500, y: 310, employeeId: "product-strategist", rotationDeg: 0 },
    { id: "desk-growth", zoneId: "workstations", x: 760, y: 310, employeeId: "growth-marketer", rotationDeg: 0 },
  ],
};

describe("Phase 8 NavGrid & A* Pathfinding", () => {
  it("routes cleanly between desks, carved room doorways, meeting seats, and lounge without hitting obstacles", () => {
    const grid = buildOfficeNavGrid(SAMPLE_FLOORPLAN);

    const gmPose = getDeskPoseWorld(SAMPLE_FLOORPLAN.desks[0]!, SAMPLE_FLOORPLAN);
    const engPose = getDeskPoseWorld(SAMPLE_FLOORPLAN.desks[2]!, SAMPLE_FLOORPLAN);
    const seats = getMeetingSeatsWorld(SAMPLE_FLOORPLAN);

    // GM office -> Engineer workstation must cross through carved glass partition doorway
    const gmToEng = findPath(grid, gmPose.seatPos, engPose.seatPos);
    expect(gmToEng.length).toBeGreaterThan(0);
    for (const wp of gmToEng) {
      expect(isWorldWalkable(grid, wp.x, wp.z)).toBe(true);
    }

    // Engineer desk -> Meeting room seat must navigate around workstations & enter conference doorway
    const engToMeeting = findPath(grid, engPose.seatPos, seats[0]!.seatPos);
    expect(engToMeeting.length).toBeGreaterThan(0);
    for (const wp of engToMeeting) {
      expect(isWorldWalkable(grid, wp.x, wp.z)).toBe(true);
    }

    // Desk centers themselves are blocked obstacles
    expect(isWorldWalkable(grid, gmPose.center.x, gmPose.center.z)).toBe(false);
    expect(isWorldWalkable(grid, engPose.center.x, engPose.center.z)).toBe(false);
  });

  it("rebuilds obstacles accurately when a desk is moved and rotated to 90 degrees", () => {
    const rotatedPlan: OfficeFloorplan = {
      ...SAMPLE_FLOORPLAN,
      desks: SAMPLE_FLOORPLAN.desks.map((d) =>
        d.id === "desk-eng" ? { ...d, x: 820, y: 150, rotationDeg: 90 } : d,
      ),
    };
    const grid = buildOfficeNavGrid(rotatedPlan);
    const movedEng = getDeskPoseWorld(rotatedPlan.desks[2]!, rotatedPlan);

    expect(movedEng.rotationDeg).toBe(90);
    expect(isWorldWalkable(grid, movedEng.center.x, movedEng.center.z)).toBe(false);

    const hrPose = getDeskPoseWorld(rotatedPlan.desks[1]!, rotatedPlan);
    const path = findPath(grid, hrPose.seatPos, movedEng.approachPos);
    expect(path.length).toBeGreaterThan(0);
  });

  it("clamps First-Person movement safely along walls and blocks desk penetration", () => {
    const grid = buildOfficeNavGrid(SAMPLE_FLOORPLAN);
    const start = { x: 0.4, y: 1.62, z: 1.2 };
    // Try pushing deep outside outer northern perimeter wall
    const clampedOuter = clampWalkablePosition(grid, start, { x: 0.4, y: 1.62, z: -9.5 }, 0.24);
    expect(clampedOuter.z).toBe(start.z);

    // Normal open aisle step succeeds
    const validStep = clampWalkablePosition(grid, start, { x: 0.65, y: 1.62, z: 1.2 }, 0.24);
    expect(validStep.x).toBeCloseTo(0.65, 2);
  });
});
