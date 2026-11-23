import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserSecurityPolicy } from "@virtual-office/shared";
import {
  CredentialVault,
  FileMasterKeyProvider,
  StaticMasterKeyProvider,
} from "../src/governance/vault.js";
import { BrowserGuardError, assertAllowedBrowserUrl } from "../src/mcp/gateway-tools.js";

describe("Encrypted Credential Vault & Controlled Browser SSRF Guard", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("encrypts secrets with AES-256-GCM, masks list summaries, and rejects ciphertext tampering", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vo-vault-"));
    tempDirs.push(dir);
    const vaultPath = path.join(dir, "vault.enc.json");
    const masterKey = crypto.randomBytes(32);

    const vault = new CredentialVault(vaultPath, new StaticMasterKeyProvider(masterKey));
    const summary = vault.setSecret("OPENAI_API_KEY", "sk-proj-supersecretkey1234567890", "openai_api");

    expect(summary.key).toBe("OPENAI_API_KEY");
    expect(summary.maskedValue).toBe("sk-p...7890");
    expect(summary.maskedValue).not.toContain("supersecretkey");

    // Stored JSON on disk must NOT contain plaintext secret
    const diskText = fs.readFileSync(vaultPath, "utf8");
    expect(diskText).not.toContain("supersecretkey1234567890");

    // Re-load from disk with same master key -> decrypts cleanly
    const reloaded = new CredentialVault(vaultPath, new StaticMasterKeyProvider(masterKey));
    expect(reloaded.listKeys()).toHaveLength(1);
    expect(reloaded.getSecret("OPENAI_API_KEY")).toBe("sk-proj-supersecretkey1234567890");

    // Tamper with auth tag -> must throw AES-GCM verification failure
    const parsed = JSON.parse(diskText) as {
      entries: { OPENAI_API_KEY: { cipherB64: string } };
    };
    const tamperedBuf = Buffer.from(parsed.entries.OPENAI_API_KEY.cipherB64, "base64");
    tamperedBuf[0] = (tamperedBuf[0] ?? 0) ^ 0xff;
    parsed.entries.OPENAI_API_KEY.cipherB64 = tamperedBuf.toString("base64");
    fs.writeFileSync(vaultPath, JSON.stringify(parsed), "utf8");

    const tamperedVault = new CredentialVault(vaultPath, new StaticMasterKeyProvider(masterKey));
    expect(() => tamperedVault.getSecret("OPENAI_API_KEY")).toThrow();

    // FileMasterKeyProvider roundtrip & delete
    const fileVault = new CredentialVault(
      path.join(dir, "file-vault.enc.json"),
      new FileMasterKeyProvider(path.join(dir, "vault.key")),
    );
    fileVault.setSecret("GITHUB_TOKEN", "ghp_1234567890abcdefghij");
    expect(fileVault.getSecret("GITHUB_TOKEN")).toBe("ghp_1234567890abcdefghij");
    expect(fileVault.deleteSecret("GITHUB_TOKEN")).toBe(true);
    expect(fileVault.getSecret("GITHUB_TOKEN")).toBeNull();
  });

  it("blocks SSRF private/loopback/metadata/non-HTTPS/non-allowlisted URLs and allows valid HTTPS allowlisted URLs", () => {
    const policy: BrowserSecurityPolicy = {
      enabled: true,
      domainAllowlist: ["github.com", "api.github.com", "docs.github.com"],
      maxResponseBytes: 262_144,
    };

    expect(assertAllowedBrowserUrl("https://api.github.com/repos/foo/bar", policy).hostname).toBe(
      "api.github.com",
    );
    expect(assertAllowedBrowserUrl("https://gist.github.com/user", policy).hostname).toBe(
      "gist.github.com",
    );

    // Non-HTTPS blocked
    expect(() => assertAllowedBrowserUrl("http://github.com/test", policy)).toThrow(
      BrowserGuardError,
    );
    expect(() => assertAllowedBrowserUrl("file:///etc/passwd", policy)).toThrow(BrowserGuardError);

    // SSRF targets blocked
    expect(() => assertAllowedBrowserUrl("https://127.0.0.1/admin", policy)).toThrow(
      BrowserGuardError,
    );
    expect(() => assertAllowedBrowserUrl("https://localhost:4310/api", policy)).toThrow(
      BrowserGuardError,
    );
    expect(() => assertAllowedBrowserUrl("https://169.254.169.254/latest/meta-data", policy)).toThrow(
      BrowserGuardError,
    );
    expect(() => assertAllowedBrowserUrl("https://10.0.0.1/", policy)).toThrow(BrowserGuardError);

    // Unlisted domain blocked
    expect(() => assertAllowedBrowserUrl("https://evil.example.com/exfiltrate", policy)).toThrow(
      BrowserGuardError,
    );

    // Embedded credentials blocked
    expect(() => assertAllowedBrowserUrl("https://user:pass@github.com/", policy)).toThrow(
      BrowserGuardError,
    );
  });
});
