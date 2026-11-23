import path from "node:path";
import { redactSecrets } from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";

export interface GuardedOutput {
  preview: string;
  truncated: boolean;
  artifactPath?: string;
}

/**
 * Redacts secrets from tool/CLI outputs and spills oversized outputs (> maxInlineBytes)
 * to disk under `data/artifacts/<runId>/` so WebSocket and SQLite stay responsive.
 */
export function sanitizeAndSpillOutput(input: {
  runId: string;
  stepKey: string;
  rawText: string;
  artifactsDir: string;
  maxInlineBytes?: number;
}): GuardedOutput {
  const maxBytes = input.maxInlineBytes ?? 32 * 1024;
  const redacted = redactSecrets(input.rawText);
  const byteLength = Buffer.byteLength(redacted, "utf8");

  if (byteLength <= maxBytes) {
    return { preview: redacted, truncated: false };
  }

  const safeStepKey = input.stepKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const artifactPath = path.join(input.artifactsDir, input.runId, `${safeStepKey}.log`);
  atomicWriteFile(artifactPath, redacted);

  const headSize = Math.floor(maxBytes * 0.45);
  const tailSize = Math.floor(maxBytes * 0.45);
  const head = redacted.slice(0, headSize);
  const tail = redacted.slice(-tailSize);

  return {
    preview: `${head}\n\n... [truncated ${byteLength - head.length - tail.length} chars; full log saved at ${artifactPath}] ...\n\n${tail}`,
    truncated: true,
    artifactPath,
  };
}
