import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeJsonPath = path.join(repoRoot, "data", "runtime.json");

function pnpmCommand() {
  if (process.platform === "win32") {
    return { cmd: "cmd.exe", prefixArgs: ["/c", "pnpm"] };
  }
  return { cmd: "pnpm", prefixArgs: [] };
}

function killTree(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
        resolve();
      });
    });
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore
  }
  return Promise.resolve();
}

function pipePrefixed(proc, label) {
  if (proc.stdout) {
    const rlOut = readline.createInterface({ input: proc.stdout });
    rlOut.on("line", (line) => console.log(`[${label}] ${line}`));
  }
  if (proc.stderr) {
    const rlErr = readline.createInterface({ input: proc.stderr });
    rlErr.on("line", (line) => console.error(`[${label}] ${line}`));
  }
}

async function waitForServerRuntime(startedAtMs, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(runtimeJsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(runtimeJsonPath, "utf8"));
        if (meta.port && meta.token && meta.startedAt && Date.parse(meta.startedAt) >= startedAtMs - 2000) {
          return;
        }
      } catch {
        // File might still be flushing
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for Virtual Office server runtime.json");
}

async function main() {
  const { cmd, prefixArgs } = pnpmCommand();
  const bootTime = Date.now();

  console.log("[dev] Starting @virtual-office/server...");
  const serverProc = spawn(cmd, [...prefixArgs, "--filter", "@virtual-office/server", "dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipePrefixed(serverProc, "server");

  let webProc = null;
  let shuttingDown = false;

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[dev] Shutting down server and web processes...");
    await Promise.all([killTree(webProc?.pid), killTree(serverProc.pid)]);
    process.exit(0);
  };

  process.on("SIGINT", () => void cleanup());
  process.on("SIGTERM", () => void cleanup());

  serverProc.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev] Server exited unexpectedly with code ${code}`);
      void cleanup();
    }
  });

  await waitForServerRuntime(bootTime);
  console.log("[dev] Server ready — starting @virtual-office/web on http://127.0.0.1:5173 ...");

  webProc = spawn(cmd, [...prefixArgs, "--filter", "@virtual-office/web", "dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipePrefixed(webProc, "web");

  webProc.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev] Web dev server exited with code ${code}`);
      void cleanup();
    }
  });
}

main().catch((err) => {
  console.error("[dev] Fatal error:", err);
  process.exit(1);
});
