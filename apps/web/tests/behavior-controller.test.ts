import { describe, expect, it } from "vitest";
import type { LoadedEmployee, MeetingRecord, OfficeFloorplan } from "@virtual-office/shared";
import {
  createInitialAgentStates,
  stepBehaviorSystem,
  type EmployeeBehaviorInput,
} from "../src/components/office3d/behavior-controller.ts";
import { dist2D, getLoungeSpotsWorld, getMeetingTableWorld } from "../src/components/office3d/coordinates.ts";
import { buildOfficeNavGrid } from "../src/components/office3d/navgrid.ts";

const FLOORPLAN: OfficeFloorplan = {
  width: 1200,
  height: 760,
  theme: "sunlit_studio",
  zones: [
    { id: "manager-office", name: "Executive", nameAr: "الإدارة", kind: "manager_office", x: 40, y: 40, width: 340, height: 280 },
    { id: "meeting-room", name: "Meeting", nameAr: "الاجتماعات", kind: "meeting_room", x: 40, y: 360, width: 340, height: 360 },
    { id: "workstations", name: "Work", nameAr: "العمل", kind: "workstations", x: 420, y: 40, width: 740, height: 440 },
    { id: "lounge", name: "Lounge", nameAr: "الاستراحة", kind: "lounge", x: 420, y: 520, width: 740, height: 200 },
  ],
  desks: [
    { id: "desk-gm", zoneId: "manager-office", x: 160, y: 140, employeeId: "general-manager", rotationDeg: 0 },
    { id: "desk-eng", zoneId: "workstations", x: 760, y: 130, employeeId: "senior-engineer", rotationDeg: 0 },
  ],
};

function makeEmp(id: string, deskId: string): LoadedEmployee {
  return {
    profile: {
      id,
      name: id,
      nameAr: id,
      role: "Role",
      roleAr: "دور",
      department: "engineering",
      avatar: "E",
      deskId,
      runtime: { provider: "mock", model: "mock-1" },
      isOrchestrator: id === "general-manager",
    },
    permissions: {
      allowedTools: ["read_file"],
      deniedTools: [],
      maxRiskTier: "tier1_auto",
      tier2AutoInWorktree: false,
      allowExternalWrite: false,
      allowedProjectIds: "*",
      maxStepsPerRun: 10,
      taskBudgetUsd: 1,
      dailyBudgetUsd: 5,
      grantedEnvKeys: [],
    },
    systemPrompt: "",
    skills: [],
    rootDir: `/tmp/${id}`,
  };
}

describe("Phase 8 AvatarBehaviorController HFSM", () => {
  const employees = [makeEmp("general-manager", "desk-gm"), makeEmp("senior-engineer", "desk-eng")];
  const navGrid = buildOfficeNavGrid(FLOORPLAN);

  it("keeps idle employees seated in quiet mode and when reducedMotion is enabled", () => {
    const agents = createInitialAgentStates(employees, FLOORPLAN);
    const inputs: EmployeeBehaviorInput[] = [
      { employeeId: "general-manager", deskId: "desk-gm", liveStatus: "idle", activeToolName: null },
      { employeeId: "senior-engineer", deskId: "desk-eng", liveStatus: "idle", activeToolName: null },
    ];

    for (let i = 0; i < 1200; i += 1) {
      stepBehaviorSystem(agents, inputs, navGrid, FLOORPLAN, 0.1, {
        ambientMode: "quiet",
        reducedMotion: false,
        meetings: [],
      });
    }
    expect(agents["senior-engineer"]!.animState).toBe("SeatedIdle");
    expect(agents["senior-engineer"]!.targetKind).toBe("desk");

    for (let i = 0; i < 600; i += 1) {
      stepBehaviorSystem(agents, inputs, navGrid, FLOORPLAN, 0.1, {
        ambientMode: "lively",
        reducedMotion: true,
        meetings: [],
      });
    }
    expect(agents["senior-engineer"]!.animState).toBe("SeatedIdle");
  });

  it("preempts AmbientLounge stroll immediately when working or waiting_approval arrives", () => {
    const agents = createInitialAgentStates(employees, FLOORPLAN);
    const loungeSpot = getLoungeSpotsWorld(FLOORPLAN)[0]!;
    // Simulate senior-engineer mid-stroll inside lounge
    agents["senior-engineer"]!.targetKind = "lounge";
    agents["senior-engineer"]!.loungeSpotId = loungeSpot.id;
    agents["senior-engineer"]!.loungeDwellRemaining = 18;
    agents["senior-engineer"]!.targetKey = `lounge:${loungeSpot.id}`;
    agents["senior-engineer"]!.position = { ...loungeSpot.standPos };
    agents["senior-engineer"]!.animState = "AmbientLounge";

    // Instant Preemption: work arrives
    const workInputs: EmployeeBehaviorInput[] = [
      { employeeId: "general-manager", deskId: "desk-gm", liveStatus: "idle", activeToolName: null },
      { employeeId: "senior-engineer", deskId: "desk-eng", liveStatus: "working", activeToolName: "read_file" },
    ];
    stepBehaviorSystem(agents, workInputs, navGrid, FLOORPLAN, 0.05, {
      ambientMode: "balanced",
      reducedMotion: false,
      meetings: [],
    });

    expect(agents["senior-engineer"]!.targetKind).toBe("desk");
    expect(agents["senior-engineer"]!.loungeSpotId).toBeNull();
    expect(agents["senior-engineer"]!.animState).toBe("Walking");

    // Step until settled back at desk -> TypingActive
    for (let i = 0; i < 160; i += 1) {
      stepBehaviorSystem(agents, workInputs, navGrid, FLOORPLAN, 0.05, {
        ambientMode: "balanced",
        reducedMotion: false,
        meetings: [],
      });
    }
    expect(agents["senior-engineer"]!.animState).toBe("TypingActive");

    // Transition to Tier 3 waiting_approval -> HandRaiseApproval
    const approvalInputs: EmployeeBehaviorInput[] = [
      { employeeId: "general-manager", deskId: "desk-gm", liveStatus: "idle", activeToolName: null },
      { employeeId: "senior-engineer", deskId: "desk-eng", liveStatus: "waiting_approval", activeToolName: "write_file" },
    ];
    for (let i = 0; i < 40; i += 1) {
      stepBehaviorSystem(agents, approvalInputs, navGrid, FLOORPLAN, 0.05, {
        ambientMode: "balanced",
        reducedMotion: false,
        meetings: [],
      });
    }
    expect(agents["senior-engineer"]!.animState).toBe("HandRaiseApproval");
  });

  it("walks meeting participants to boardroom seats, animates active speaker, and returns on COMPLETED", () => {
    const agents = createInitialAgentStates(employees, FLOORPLAN);
    const inputs: EmployeeBehaviorInput[] = [
      { employeeId: "general-manager", deskId: "desk-gm", liveStatus: "idle", activeToolName: null },
      { employeeId: "senior-engineer", deskId: "desk-eng", liveStatus: "idle", activeToolName: null },
    ];
    const meeting: MeetingRecord = {
      id: "mtg-1",
      topic: "Architecture Review",
      agenda: "",
      projectId: null,
      facilitatorEmployeeId: "general-manager",
      participantEmployeeIds: ["senior-engineer", "general-manager"],
      maxRounds: 2,
      mode: "mock",
      autoCreateTasks: false,
      status: "RUNNING",
      turns: [
        {
          id: "t1",
          meetingId: "mtg-1",
          round: 1,
          turnIndex: 0,
          employeeId: "senior-engineer",
          runId: null,
          summary: "Proposal ready",
          keyPoints: [],
          createdAt: new Date().toISOString(),
        },
      ],
      decisions: [],
      actionItems: [],
      minutesSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
    };

    for (let i = 0; i < 200; i += 1) {
      stepBehaviorSystem(agents, inputs, navGrid, FLOORPLAN, 0.05, {
        ambientMode: "quiet",
        reducedMotion: false,
        meetings: [meeting],
      });
    }

    const table = getMeetingTableWorld(FLOORPLAN);
    expect(agents["senior-engineer"]!.animState).toBe("MeetingTalking");
    expect(agents["general-manager"]!.animState).toBe("MeetingSeated");
    expect(dist2D(agents["senior-engineer"]!.position, table.center)).toBeLessThan(2.0);
    expect(dist2D(agents["general-manager"]!.position, table.center)).toBeLessThan(2.0);

    // Meeting completes -> both return cleanly to desk SeatedIdle
    const completedMeeting: MeetingRecord = { ...meeting, status: "COMPLETED" };
    for (let i = 0; i < 220; i += 1) {
      stepBehaviorSystem(agents, inputs, navGrid, FLOORPLAN, 0.05, {
        ambientMode: "quiet",
        reducedMotion: false,
        meetings: [completedMeeting],
      });
    }
    expect(agents["senior-engineer"]!.animState).toBe("SeatedIdle");
    expect(agents["general-manager"]!.animState).toBe("SeatedIdle");
  });
});
