import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverEntry = path.join(repoRoot, "apps", "server", "dist", "index.js");
const webIndex = path.join(repoRoot, "apps", "web", "dist", "index.html");
const desktopProfileDir = path.join(repoRoot, "data", "desktop-profile");
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
  console.log("[desktop] Production artifacts missing — building workspace...");
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
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}/api/health`);
}

function findDesktopShellBinary() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const candidates = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ];
    return candidates.find((p) => p && fs.existsSync(p)) ?? null;
  }
  return null;
}

async function main() {
  await runBuildIfNeeded();
  const port = Number(process.env.PORT ?? 4310);
  const url = `http://127.0.0.1:${port}`;
  console.log(`[desktop] Starting Virtual Office standalone server on ${url} ...`);

  const serverProc = spawn("node", [serverEntry], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!serverProc.killed) {
      serverProc.kill("SIGTERM");
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  serverProc.on("exit", (code) => {
    if (!shuttingDown) process.exit(code ?? 0);
  });

  await waitForHealth(url);
  console.log(`[desktop] Backend ready at ${url}`);

  if (noOpen) return;

  const browserBin = findDesktopShellBinary();
  if (!browserBin) {
    console.log("[desktop] Edge/Chrome not found — opening in default browser...");
    if (process.platform === "win32") {
      execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true }, () => {});
    }
    return;
  }

  fs.mkdirSync(desktopProfileDir, { recursive: true });
  const appStartedAt = Date.now();
  const appProc = spawn(
    browserBin,
    [
      `--app=${url}`,
      "--window-size=1440,900",
      `--user-data-dir=${desktopProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    {
      cwd: repoRoot,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  appProc.on("exit", () => {
    // Only auto-stop server if dedicated app window stayed open > 2s (avoid premature exit if handed off)
    if (Date.now() - appStartedAt > 2_000) {
      shutdown();
    }
  });
}

main().catch((err) => {
  console.error("[desktop] Launch failed:", err);
  process.exit(1);
});
