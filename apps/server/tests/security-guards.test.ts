import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSensitiveFilePath, redactSecrets } from "@virtual-office/shared";
import {
  PathAccessError,
  assertPathWithinRoots,
  assertReadableProjectFile,
} from "../src/company/path-guard.js";
import { sanitizeAndSpillOutput } from "../src/governance/output-guard.js";
import { buildSafeChildEnv } from "../src/runtime/env-builder.js";

describe("Security Guards (Redaction, Path/Symlink Containment, Env Allowlist, Output Spill)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts API keys, GitHub tokens, Bearer headers, PEM keys, and sensitive key=value lines", () => {
    const sample = [
      "OPENAI_API_KEY=sk-proj-1234567890abcdefghij",
      "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "GOOGLE_KEY=AIzaSyB1234567890abcdefghijklmno",
      "GITHUB=ghp_1234567890abcdefghijklmnop",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQE...\n-----END RSA PRIVATE KEY-----",
      "Safe note: normal text stays untouched.",
    ].join("\n");

    const clean = redactSecrets(sample);
    expect(clean).not.toContain("sk-proj-1234567890");
    expect(clean).not.toContain("sk-ant-api03");
    expect(clean).not.toContain("AIzaSyB1234567890");
    expect(clean).not.toContain("ghp_1234567890");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(clean).not.toContain("MIIEowIBAAKCAQE");
    expect(clean).toContain("Bearer [REDACTED_SECRET]");
    expect(clean).toContain("Safe note: normal text stays untouched.");
  });

  it("identifies sensitive files while permitting .env.example and regular code", () => {
    expect(isSensitiveFilePath("/app/.env")).toBe(true);
    expect(isSensitiveFilePath("C:\\repo\\.env.production")).toBe(true);
    expect(isSensitiveFilePath("/app/keys/id_rsa")).toBe(true);
    expect(isSensitiveFilePath("/app/certs/server.pem")).toBe(true);
    expect(isSensitiveFilePath("/app/service-account-credentials.json")).toBe(true);
    expect(isSensitiveFilePath("/app/.git/config")).toBe(true);

    expect(isSensitiveFilePath("/app/.env.example")).toBe(false);
    expect(isSensitiveFilePath("/app/.env.sample")).toBe(false);
    expect(isSensitiveFilePath("/app/src/index.ts")).toBe(false);
  });

  it("blocks parent-directory traversal, symlink/junction escapes, and unapproved .env reads", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "vo-path-"));
    tempDirs.push(base);

    const projectDir = path.join(base, "project");
    const outsideDir = path.join(base, "outside");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    const safeFile = path.join(projectDir, "src.ts");
    const envFile = path.join(projectDir, ".env");
    const secretOutside = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(safeFile, "export const ok = true;", "utf8");
    fs.writeFileSync(envFile, "SECRET=1234567890", "utf8");
    fs.writeFileSync(secretOutside, "outside secret", "utf8");

    expect(assertReadableProjectFile(safeFile, [projectDir])).toBe(fs.realpathSync.native(safeFile));

    // Traversal attack
    expect(() =>
      assertPathWithinRoots(path.join(projectDir, "..", "outside", "secret.txt"), [projectDir]),
    ).toThrow(PathAccessError);

    // Junction / Symlink escape
    const linkPath = path.join(projectDir, "escape-link");
    fs.symlinkSync(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    expect(() =>
      assertPathWithinRoots(path.join(linkPath, "secret.txt"), [projectDir]),
    ).toThrow(PathAccessError);

    // .env blocked by default, permitted only when explicitly unlocked
    expect(() => assertReadableProjectFile(envFile, [projectDir])).toThrow(PathAccessError);
    const unlocked = new Set([fs.realpathSync.native(envFile)]);
    expect(assertReadableProjectFile(envFile, [projectDir], unlocked)).toBe(
      fs.realpathSync.native(envFile),
    );
  });

  it("builds an allowlisted child env stripping host secrets unless explicitly granted", () => {
    const prevStripe = process.env.STRIPE_SECRET_KEY;
    const prevGh = process.env.GH_TOKEN;
    const prevGranted = process.env.MY_ALLOWED_TOOL_TOKEN;

    process.env.STRIPE_SECRET_KEY = "sk_live_test_secret_123456";
    process.env.GH_TOKEN = "ghp_test_token_1234567890abcdef";
    process.env.MY_ALLOWED_TOOL_TOKEN = "allowed_value_999";

    try {
      const childEnv = buildSafeChildEnv(["MY_ALLOWED_TOOL_TOKEN"]);
      expect(childEnv.STRIPE_SECRET_KEY).toBeUndefined();
      expect(childEnv.GH_TOKEN).toBeUndefined();
      expect(childEnv.MY_ALLOWED_TOOL_TOKEN).toBe("allowed_value_999");
      expect(childEnv.LANG).toBe("C.UTF-8");
      expect(childEnv.NO_COLOR).toBe("1");
      expect(childEnv.PATH || childEnv.Path).toBeTruthy();
    } finally {
      if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevStripe;

      if (prevGh === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = prevGh;

      if (prevGranted === undefined) delete process.env.MY_ALLOWED_TOOL_TOKEN;
      else process.env.MY_ALLOWED_TOOL_TOKEN = prevGranted;
    }
  });

  it("redacts secrets and spills oversized tool output to disk", () => {
    const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "vo-spill-"));
    tempDirs.push(artifactsDir);

    const huge = `START OPENAI_API_KEY=sk-proj-secret1234567890123456\n${"x".repeat(4096)}\nEND`;
    const result = sanitizeAndSpillOutput({
      runId: "run-1",
      stepKey: "step-1",
      rawText: huge,
      artifactsDir,
      maxInlineBytes: 512,
    });

    expect(result.truncated).toBe(true);
    expect(result.artifactPath).toBeTruthy();
    expect(result.preview).toContain("[REDACTED_SECRET]");
    expect(result.preview).not.toContain("sk-proj-secret1234567890123456");

    const spilled = fs.readFileSync(result.artifactPath!, "utf8");
    expect(spilled).toContain("[REDACTED_SECRET]");
    expect(spilled).not.toContain("sk-proj-secret1234567890123456");
  });
});
