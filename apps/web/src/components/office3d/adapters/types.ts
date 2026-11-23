import type { LoadedEmployee } from "@virtual-office/shared";
import type { MutableRefObject } from "react";
import type { Locale } from "../../../i18n/translations.ts";
import type { EmployeeLiveStatus } from "../../../store/office-store.ts";
import type { AvatarAgentState, AvatarAnimState } from "../behavior-controller.ts";

export type AvatarClipName = "Idle" | "Walk" | "Sit" | "Type" | "Talk" | "RaiseHand";

export function animStateToClipName(state: AvatarAnimState): AvatarClipName {
  switch (state) {
    case "Walking":
      return "Walk";
    case "TypingActive":
      return "Type";
    case "MeetingTalking":
      return "Talk";
    case "HandRaiseApproval":
      return "RaiseHand";
    case "SeatedIdle":
    case "MeetingSeated":
    case "AlertFailed":
      return "Sit";
    case "AmbientLounge":
    default:
      return "Idle";
  }
}

export interface AvatarAdapterProps {
  employee: LoadedEmployee;
  deptColor: string;
  agentsMapRef: MutableRefObject<Record<string, AvatarAgentState>>;
  operationalMode: EmployeeLiveStatus | "meeting";
  activeToolName: string | null;
  selected: boolean;
  hovered: boolean;
  reducedMotion: boolean;
  locale: Locale;
  modelUrl?: string;
  onSelect: (employeeId: string) => void;
  onHoverChange: (employeeId: string | null) => void;
}
