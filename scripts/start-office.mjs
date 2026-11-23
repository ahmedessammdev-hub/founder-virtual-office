import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverEntry = path.join(repoRoot, "apps", "server", "dist", "index.js");
const webIndex = path.join(repoRoot, "apps", "web", "dist", "index.html");
const noOpen = process.argv.includes("--no-open");

function pnpmCmd() {
  return process.platform === "win32"
    ? { cmd: "cmd.exe", args: ["/c", "pnpm"] }
    : { cmd: "pnpm", args: [] };
}

function runBuildIfNeeded() {
  if (fs.existsSync(serverEntry) && fs.existsSync(webIndex)) {
    return Promise.resolve();
  }
  console.log("[office] Production artifacts not found — building workspace...");
  return new Promise((resolve, reject) => {
    const { cmd, args } = pnpmCmd();
    const child = spawn(cmd, [...args, "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with exit code ${code}`));
    });
  });
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${url}/api/health`);
      if (resp.ok) return;
    } catch {
      // Server still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}/api/health`);
}

function openBrowser(url) {
  if (noOpen) return;
  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true }, () => {});
  } else if (process.platform === "darwin") {
    execFile("open", [url], () => {});
  } else {
    execFile("xdg-open", [url], () => {});
  }
}

async function main() {
  await runBuildIfNeeded();
  const port = Number(process.env.PORT ?? 4310);
  const url = `http://127.0.0.1:${port}`;
  console.log(`[office] Launching Founder Virtual Office at ${url} ...`);

  const serverProc = spawn("node", [serverEntry], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });

  const shutdown = () => {
    if (!serverProc.killed) {
      serverProc.kill("SIGTERM");
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  serverProc.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  await waitForHealth(url);
  console.log(`[office] Ready at ${url}`);
  openBrowser(url);
}

main().catch((err) => {
  console.error("[office] Failed to start:", err);
  process.exit(1);
});
