import type {
  CompanyConfig,
  LoadedEmployee,
  MemoryEntry,
  NormalizedAgentEvent,
  Project,
  RiskTier,
  RunMode,
  RuntimeProvider,
} from "@virtual-office/shared";
import type { ConversationRecord, MessageRecord } from "../db/repositories/conversations-repo.js";

export interface ExternalInputSnippet {
  source: string;
  content: string;
}

export interface AssembledContext {
  composedPrompt: string;
  stats: {
    estimatedTokens: number;
    slices: Record<string, number>;
  };
  injectedMemoryIds: string[];
  hasUntrustedExternalInput: boolean;
}

export interface AdapterExecuteInput {
  runId: string;
  mode: RunMode;
  provider: RuntimeProvider;
  model: string;
  effort?: string;
  riskTier: RiskTier;
  company: CompanyConfig;
  employee: LoadedEmployee;
  project: Project | null;
  conversation: ConversationRecord;
  recentMessages: MessageRecord[];
  retrievedMemories: MemoryEntry[];
  rawUserPrompt: string;
  assembled: AssembledContext;
  mockScenario?: string;
  artifactsDir: string;
  workingDir: string;
  officeMcpUrl?: string;
  officeRunToken?: string;
}

export type EventEmitterFn = (event: NormalizedAgentEvent) => void;

export interface RuntimeAdapter {
  readonly provider: RuntimeProvider;
  execute(
    input: AdapterExecuteInput,
    emit: EventEmitterFn,
    signal: AbortSignal,
  ): Promise<void>;
}
