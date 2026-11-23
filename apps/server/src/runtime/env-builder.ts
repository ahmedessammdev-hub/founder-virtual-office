import { execFileSync } from "node:child_process";

const WINDOWS_ESSENTIAL_KEYS = [
  "SystemRoot",
  "SYSTEMDRIVE",
  "ComSpec",
  "PATH",
  "Path",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "WINDIR",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  // Allow user Codex/AGY config home overrides if explicitly set in OS profile
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];

/**
 * Builds an Allowlist-based environment dictionary for child processes (`agy`, `codex`, etc.)
 * so Windows system tools and local CLI auth work while host secrets (`AWS_*`, `STRIPE_*`,
 * `GH_TOKEN`, `DATABASE_URL`, etc.) are NEVER accidentally inherited.
 */
export function buildSafeChildEnv(
  grantedEnvKeys: string[] = [],
  extraEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};

  for (const key of WINDOWS_ESSENTIAL_KEYS) {
    const val = process.env[key];
    if (val !== undefined) {
      safe[key] = val;
    }
  }

  for (const key of grantedEnvKeys) {
    const val = process.env[key];
    if (val !== undefined) {
      safe[key] = val;
    }
  }

  safe.LANG = "C.UTF-8";
  safe.NO_COLOR = "1";
  safe.FORCE_COLOR = "0";
  safe.TERM = "dumb";

  for (const [key, val] of Object.entries(extraEnv)) {
    safe[key] = val;
  }

  return safe;
}

/**
 * Resolves an executable path, preferring `.exe` binaries on Windows so `spawn(..., { shell: false })`
 * never hits EINVAL on `.cmd` shims.
 */
export function resolveExecutable(command: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", [command], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const candidates = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const exe = candidates.find((p) => p.toLowerCase().endsWith(".exe"));
      return exe ?? candidates[0] ?? null;
    }
    const out = execFileSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}
