import { execFile } from "node:child_process";

/**
 * Kills an entire process tree so cancelling or timing out a CLI run on Windows
 * never leaves orphan child processes running in the background.
 */
export function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
        resolve();
      });
    });
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited
    }
  }
  return Promise.resolve();
}
