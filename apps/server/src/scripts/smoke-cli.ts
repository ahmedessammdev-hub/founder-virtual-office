import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Run } from "@virtual-office/shared";
import { createOfficeServer } from "../api/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

function waitForRunDone(
  getRun: (id: string) => Run | null,
  runId: string,
  timeoutMs = 60_000,
): Promise<Run | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const r = getRun(runId);
      if (
        r &&
        ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "BUDGET_EXCEEDED", "WAITING_APPROVAL"].includes(r.status)
      ) {
        clearInterval(timer);
        resolve(r);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(r);
      }
    }, 100);
  });
}

async function main(): Promise<void> {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vo-smoke-"));
  const ctx = await createOfficeServer({
    companyRoot: path.join(repoRoot, "company"),
    dataDir: tempDataDir,
    enableWatcher: false,
    probeProvidersOnBoot: true,
    deltaFlushIntervalMs: 100,
  });

  try {
    console.log("=== 1. Provider Health Probe ===");
    const health = ctx.providerDetector.getCached();
    for (const item of health) {
      console.log(
        ` - ${item.provider.padEnd(14)} installed=${String(item.installed).padEnd(5)} available=${String(item.available).padEnd(5)} auth=${item.authStatus.padEnd(15)} info=${item.message ?? ""}`,
      );
    }

    console.log("\n=== 2. Mock Run Check ===");
    const mockRun = ctx.supervisor.enqueueRun({
      employeeId: "general-manager",
      prompt: "اختبار تشغيلي للمكتب الافتراضي",
      mode: "mock",
    });
    const mockDone = await waitForRunDone((id) => ctx.repos.runs.getById(id), mockRun.id, 10_000);
    console.log(`Mock status=${mockDone?.status}, output=${mockDone?.finalOutput}`);

    console.log("\n=== 3. Dry-Run Check ===");
    const dryRun = ctx.supervisor.enqueueRun({
      employeeId: "senior-engineer",
      prompt: "حلل معمارية التطبيق بدون تعديل ملفات",
      mode: "dry_run",
    });
    const dryDone = await waitForRunDone((id) => ctx.repos.runs.getById(id), dryRun.id, 10_000);
    console.log(`Dry-Run status=${dryDone?.status}, tokens=${dryDone?.inputTokens}+${dryDone?.outputTokens}`);

    const agyHealth = health.find((p) => p.provider === "agy");
    if (agyHealth?.installed && agyHealth.available) {
      console.log("\n=== 4. Live Tier 1 Read-Only AGY Probe ===");
      const agyRun = ctx.supervisor.enqueueRun(
        {
          employeeId: "hr-talent",
          prompt: "قل مرحباً بالعربي واذكر كلمة TypeScript فقط.",
          mode: "live",
          riskTier: "tier1_auto",
          providerOverride: "agy",
          modelOverride: "gemini-3.8-flash-low",
        },
        45_000,
      );
      const agyDone = await waitForRunDone((id) => ctx.repos.runs.getById(id), agyRun.id, 50_000);
      console.log(
        `AGY Live status=${agyDone?.status}, errorCode=${agyDone?.errorCode ?? "none"}, errorMessage=${agyDone?.errorMessage ?? "none"}, output=${JSON.stringify(agyDone?.finalOutput?.slice(0, 140) ?? "")}`,
      );
    } else {
      console.log("\n=== 4. AGY Live Probe skipped (not available/authenticated) ===");
    }

    const codexHealth = health.find((p) => p.provider === "codex");
    if (codexHealth?.installed && codexHealth.available) {
      console.log("\n=== 5. Live Tier 1 Read-Only Codex Probe ===");
      const codexRun = ctx.supervisor.enqueueRun(
        {
          employeeId: "senior-engineer",
          prompt: "Reply with exactly: CODEX_OK",
          mode: "live",
          riskTier: "tier1_auto",
          providerOverride: "codex",
          modelOverride: "gpt-5.6-luna",
        },
        45_000,
      );
      const codexDone = await waitForRunDone((id) => ctx.repos.runs.getById(id), codexRun.id, 50_000);
      console.log(
        `Codex Live status=${codexDone?.status}, errorCode=${codexDone?.errorCode ?? "none"}, errorMessage=${codexDone?.errorMessage ?? "none"}, output=${JSON.stringify(codexDone?.finalOutput?.slice(0, 140) ?? "")}`,
      );
    } else {
      console.log("\n=== 5. Codex Live Probe skipped (not available) ===");
    }
  } finally {
    await ctx.close();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Smoke check failed:", err);
  process.exit(1);
});
