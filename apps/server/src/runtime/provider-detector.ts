import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderHealth, RuntimeProvider } from "@virtual-office/shared";
import type { CredentialVault } from "../governance/vault.js";
import { buildSafeChildEnv, resolveExecutable } from "./env-builder.js";

function runCliProbe(
  exe: string,
  args: string[],
  timeoutMs = 5000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: buildSafeChildEnv(),
      },
      (err, stdout, stderr) => {
        const exitCode =
          err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? Number((err as { code?: number }).code)
            : err
              ? 1
              : 0;
        resolve({ code: exitCode, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

function parseAgyModels(stdout: string): string[] {
  const models: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const firstCol = trimmed.split(/\s+/)[0];
    if (firstCol && /^[a-z0-9._-]+$/i.test(firstCol)) {
      models.push(firstCol);
    }
  }
  return models;
}

function parseCodexModelsCache(): string[] {
  const cachePath = path.join(os.homedir(), ".codex", "models_cache.json");
  if (!fs.existsSync(cachePath)) {
    return ["gpt-5.6-luna", "gpt-6-astra"];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      models?: Array<{ slug?: string }>;
    };
    const slugs = (parsed.models ?? [])
      .map((m) => m.slug)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    return slugs.length > 0 ? slugs : ["gpt-5.6-luna", "gpt-6-astra"];
  } catch {
    return ["gpt-5.6-luna", "gpt-6-astra"];
  }
}

/**
 * Probes installed CLIs (`agy`, `codex`, `claude`), local `ollama`, and Direct API env vars.
 * Never crashes or prevents startup when optional providers are missing or offline.
 */
export class ProviderDetector {
  private cache: ProviderHealth[] = [];

  constructor(private readonly vault?: CredentialVault) {}

  public getCached(): ProviderHealth[] {
    return this.cache;
  }

  public async detectAll(): Promise<ProviderHealth[]> {
    const checkedAt = new Date().toISOString();
    const results = await Promise.all([
      this.probeAgy(checkedAt),
      this.probeCodex(checkedAt),
      this.probeClaude(checkedAt),
      this.probeOllama(checkedAt),
      this.probeDirectApi("gemini_api", "GEMINI_API_KEY", ["gemini-2.5-pro", "gemini-2.5-flash"], checkedAt),
      this.probeDirectApi("openai_api", "OPENAI_API_KEY", ["gpt-4.1", "o3"], checkedAt),
      this.probeDirectApi("anthropic_api", "ANTHROPIC_API_KEY", ["claude-sonnet-4-5", "claude-opus-4-5"], checkedAt),
      this.probeDirectApi("openrouter_api", "OPENROUTER_API_KEY", ["openrouter/auto"], checkedAt),
      Promise.resolve<ProviderHealth>({
        provider: "mock",
        installed: true,
        available: true,
        authStatus: "not_applicable",
        models: ["mock-deterministic-v1"],
        message: "Built-in deterministic fixture simulator",
        checkedAt,
      }),
    ]);

    this.cache = results;
    return results;
  }

  private async probeAgy(checkedAt: string): Promise<ProviderHealth> {
    const exe = resolveExecutable("agy");
    if (!exe) {
      return {
        provider: "agy",
        installed: false,
        available: false,
        authStatus: "unknown",
        models: [],
        message: "agy CLI not found in PATH",
        checkedAt,
      };
    }

    const res = await runCliProbe(exe, ["models"], 8000);
    const models = parseAgyModels(res.stdout);
    const combinedErr = `${res.stderr}\n${res.stdout}`.toLowerCase();
    const authFailed =
      combinedErr.includes("not authenticated") ||
      combinedErr.includes("login") ||
      combinedErr.includes("unauthorized");

    return {
      provider: "agy",
      installed: true,
      available: res.code === 0 && models.length > 0 && !authFailed,
      authStatus: authFailed
        ? "unauthenticated"
        : models.length > 0
          ? "authenticated"
          : "unknown",
      models,
      message: authFailed
        ? "Run `agy` to authenticate."
        : models.length > 0
          ? `Detected ${models.length} models`
          : res.stderr.trim() || "agy installed",
      checkedAt,
    };
  }

  private async probeCodex(checkedAt: string): Promise<ProviderHealth> {
    const exe = resolveExecutable("codex");
    if (!exe) {
      return {
        provider: "codex",
        installed: false,
        available: false,
        authStatus: "unknown",
        models: [],
        message: "codex CLI not found in PATH",
        checkedAt,
      };
    }

    const ver = await runCliProbe(exe, ["--version"], 5000);
    const authFile = path.join(os.homedir(), ".codex", "auth.json");
    const hasAuth = fs.existsSync(authFile);
    const models = parseCodexModelsCache();

    return {
      provider: "codex",
      installed: true,
      available: ver.code === 0,
      authStatus: hasAuth ? "authenticated" : "unknown",
      version: ver.stdout.trim() || undefined,
      models,
      message: ver.code === 0 ? `${ver.stdout.trim()} (${models.length} cached models)` : ver.stderr.trim(),
      checkedAt,
    };
  }

  private async probeClaude(checkedAt: string): Promise<ProviderHealth> {
    const exe = resolveExecutable("claude");
    if (!exe) {
      return {
        provider: "claude",
        installed: false,
        available: false,
        authStatus: "unknown",
        models: [],
        message: "claude CLI not installed (optional, Phase 2)",
        checkedAt,
      };
    }
    const ver = await runCliProbe(exe, ["--version"], 5000);
    return {
      provider: "claude",
      installed: true,
      available: ver.code === 0,
      authStatus: ver.code === 0 ? "authenticated" : "unknown",
      version: ver.stdout.trim() || undefined,
      models: ["claude-sonnet-4-5", "claude-opus-4-5"],
      message: ver.stdout.trim() || "claude installed",
      checkedAt,
    };
  }

  private async probeOllama(checkedAt: string): Promise<ProviderHealth> {
    const exe = resolveExecutable("ollama");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const resp = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return {
          provider: "ollama",
          installed: Boolean(exe),
          available: false,
          authStatus: "not_applicable",
          models: [],
          message: `Ollama endpoint returned HTTP ${resp.status}`,
          checkedAt,
        };
      }
      const data = (await resp.json()) as { models?: Array<{ name?: string }> };
      const models = (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === "string");
      return {
        provider: "ollama",
        installed: true,
        available: true,
        authStatus: "not_applicable",
        models,
        message: `Running locally (${models.length} models)`,
        checkedAt,
      };
    } catch {
      clearTimeout(timer);
      return {
        provider: "ollama",
        installed: Boolean(exe),
        available: false,
        authStatus: "not_applicable",
        models: [],
        message: exe
          ? "Ollama installed but local daemon is not running (optional)"
          : "Ollama not installed (optional)",
        checkedAt,
      };
    }
  }

  private async probeDirectApi(
    provider: RuntimeProvider,
    envKey: string,
    models: string[],
    checkedAt: string,
  ): Promise<ProviderHealth> {
    const inVault = Boolean(this.vault?.getSecret(envKey));
    const inEnv = Boolean(process.env[envKey]?.trim());
    const hasKey = inVault || inEnv;
    return {
      provider,
      installed: true,
      available: hasKey,
      authStatus: hasKey ? "authenticated" : "unauthenticated",
      models,
      message: inVault
        ? `${envKey} encrypted in Vault`
        : inEnv
          ? `${envKey} detected in environment`
          : `${envKey} not configured (add in Encrypted Vault)`,
      checkedAt,
    };
  }
}
