import fs from "node:fs";
import path from "node:path";
import type { NormalizedAgentEvent, RuntimeProvider } from "@virtual-office/shared";
import type { AdapterExecuteInput, EventEmitterFn, RuntimeAdapter } from "./types.js";

interface MockScenarioFile {
  scenarios: Record<
    string,
    {
      match: string[];
      delayMs?: number;
      steps: Array<Record<string, unknown>>;
    }
  >;
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockAdapter implements RuntimeAdapter {
  public readonly provider: RuntimeProvider = "mock";

  constructor(private readonly companyRoot: string) {}

  public async execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void> {
    const fixturePath = path.join(this.companyRoot, "fixtures", "mock-scenarios.json");
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as MockScenarioFile;

    const scenario = this.pickScenario(raw, input.mockScenario, input.rawUserPrompt);
    const delayMs = scenario.delayMs ?? 10;

    emit({ type: "session_id", sessionId: `mock-session-${input.conversation.id}`, provider: "mock" });

    for (const step of scenario.steps) {
      if (signal.aborted) {
        return;
      }
      await sleepAbortable(delayMs, signal);
      if (signal.aborted) {
        return;
      }
      emit(step as NormalizedAgentEvent);
    }
  }

  private pickScenario(
    file: MockScenarioFile,
    explicitScenario: string | undefined,
    prompt: string,
  ): MockScenarioFile["scenarios"][string] {
    if (explicitScenario && file.scenarios[explicitScenario]) {
      return file.scenarios[explicitScenario]!;
    }

    const lowerPrompt = prompt.toLowerCase();
    for (const [key, entry] of Object.entries(file.scenarios)) {
      if (key === "default") {
        continue;
      }
      for (const needle of entry.match) {
        if (needle !== "*" && lowerPrompt.includes(needle.toLowerCase())) {
          return entry;
        }
      }
    }

    return (
      file.scenarios.default ?? {
        match: ["*"],
        steps: [
          { type: "text_delta", text: "Mock completed." },
          { type: "usage", inputTokens: 100, outputTokens: 20, costUsd: 0.0005 },
          { type: "done", finalOutput: "Mock completed." },
        ],
      }
    );
  }
}
