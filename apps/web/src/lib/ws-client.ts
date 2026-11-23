import type {
  CompanyConfig,
  HiringProposal,
  MeetingRecord,
  Run,
  ScheduledJob,
  TaskPlan,
  TelegramMessageRecord,
} from "@virtual-office/shared";
import type { StoredRunEvent } from "./api.ts";

export type WsIncomingMessage =
  | { kind: "replay"; runId: string | null; events: StoredRunEvent[] }
  | { kind: "run_event"; data: StoredRunEvent }
  | { kind: "live_delta"; data: StoredRunEvent }
  | { kind: "run_status"; data: Run }
  | { kind: "plan_updated"; data: TaskPlan }
  | { kind: "meeting_updated"; data: MeetingRecord }
  | { kind: "hiring_updated"; data: HiringProposal }
  | { kind: "schedule_updated"; data: ScheduledJob }
  | { kind: "telegram_message"; data: TelegramMessageRecord }
  | { kind: "company_updated"; data: CompanyConfig }
  | { kind: "error"; message: string };

export type WsConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Auto-reconnecting WebSocket client that replays missed run events via `afterSeq`
 * after any reconnect or browser refresh.
 */
export class OfficeWsClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private retryDelayMs = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private token = "";
  private getAfterSeq: () => number;
  private onMessage: (msg: WsIncomingMessage) => void;
  private onStatus: (status: WsConnectionStatus) => void;

  constructor(opts: {
    getAfterSeq: () => number;
    onMessage: (msg: WsIncomingMessage) => void;
    onStatus: (status: WsConnectionStatus) => void;
  }) {
    this.getAfterSeq = opts.getAfterSeq;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
  }

  public connect(token: string): void {
    this.token = token;
    this.stopped = false;
    this.openSocket();
  }

  public disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatus("disconnected");
  }

  private openSocket(): void {
    if (this.stopped || !this.token) {
      return;
    }
    this.onStatus("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retryDelayMs = 500;
      this.onStatus("connected");
      ws.send(
        JSON.stringify({
          type: "subscribe",
          afterSeq: this.getAfterSeq(),
        }),
      );
    });

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as WsIncomingMessage;
        this.onMessage(msg);
      } catch {
        // Ignore malformed frame
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.onStatus("disconnected");
      if (!this.stopped) {
        const delay = this.retryDelayMs;
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 5000);
        this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }
}
