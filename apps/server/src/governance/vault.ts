import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VaultKeySummary } from "@virtual-office/shared";
import { atomicWriteFile } from "../company/atomic-fs.js";

export interface MasterKeyProvider {
  getOrCreateKey(): Buffer;
}

/**
 * Protects the 32-byte AES master key using Windows DPAPI (`CurrentUser`)
 * via PowerShell `ProtectedData`, caching the unwrapped key in process memory.
 */
export class DpapiMasterKeyProvider implements MasterKeyProvider {
  private cachedKey: Buffer | null = null;

  constructor(private readonly dpapiKeyPath: string) {}

  public getOrCreateKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    if (fs.existsSync(this.dpapiKeyPath)) {
      const protectedB64 = fs.readFileSync(this.dpapiKeyPath, "utf8").trim();
      const rawB64 = this.runPowershell(
        [
          "Add-Type -AssemblyName System.Security",
          `$enc = [Convert]::FromBase64String('${protectedB64}')`,
          "$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')",
          "[Console]::Write([Convert]::ToBase64String($dec))",
        ].join("; "),
      );
      const key = Buffer.from(rawB64.trim(), "base64");
      if (key.length !== 32) {
        throw new Error("Decrypted DPAPI vault master key has invalid length.");
      }
      this.cachedKey = key;
      return key;
    }

    const key = crypto.randomBytes(32);
    const keyB64 = key.toString("base64");
    const protectedB64 = this.runPowershell(
      [
        "Add-Type -AssemblyName System.Security",
        `$raw = [Convert]::FromBase64String('${keyB64}')`,
        "$prot = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, 'CurrentUser')",
        "[Console]::Write([Convert]::ToBase64String($prot))",
      ].join("; "),
    ).trim();

    atomicWriteFile(this.dpapiKeyPath, protectedB64);
    this.cachedKey = key;
    return key;
  }

  private runPowershell(script: string): string {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      },
    );
  }
}

export class FileMasterKeyProvider implements MasterKeyProvider {
  private cachedKey: Buffer | null = null;

  constructor(private readonly keyFilePath: string) {}

  public getOrCreateKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    if (fs.existsSync(this.keyFilePath)) {
      const hex = fs.readFileSync(this.keyFilePath, "utf8").trim();
      const buf = Buffer.from(hex, "hex");
      if (buf.length === 32) {
        this.cachedKey = buf;
        return buf;
      }
    }
    const key = crypto.randomBytes(32);
    atomicWriteFile(this.keyFilePath, key.toString("hex"));
    this.cachedKey = key;
    return key;
  }
}

export class StaticMasterKeyProvider implements MasterKeyProvider {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Static master key must be 32 bytes.");
    }
  }

  public getOrCreateKey(): Buffer {
    return this.key;
  }
}

interface EncryptedVaultEntry {
  ivB64: string;
  tagB64: string;
  cipherB64: string;
  maskedValue: string;
  providerHint?: string;
  updatedAt: string;
}

interface VaultFileShape {
  version: 1;
  entries: Record<string, EncryptedVaultEntry>;
}

function maskSecretValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "********";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * AES-256-GCM encrypted local Credential Vault storing API keys and MCP secrets.
 * Raw plaintext values are NEVER returned by `listKeys()` or REST APIs.
 */
export class CredentialVault {
  private readonly keyProvider: MasterKeyProvider;
  private entries: Record<string, EncryptedVaultEntry> = {};

  constructor(
    private readonly vaultFilePath: string,
    keyProvider?: MasterKeyProvider,
  ) {
    if (keyProvider) {
      this.keyProvider = keyProvider;
    } else if (process.platform === "win32") {
      this.keyProvider = new DpapiMasterKeyProvider(
        path.join(path.dirname(vaultFilePath), "vault.key.dpapi"),
      );
    } else {
      this.keyProvider = new FileMasterKeyProvider(
        path.join(path.dirname(vaultFilePath), "vault.key"),
      );
    }
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.vaultFilePath)) {
      this.entries = {};
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.vaultFilePath, "utf8")) as VaultFileShape;
    this.entries = parsed.entries ?? {};
  }

  private save(): void {
    const payload: VaultFileShape = {
      version: 1,
      entries: this.entries,
    };
    atomicWriteFile(this.vaultFilePath, JSON.stringify(payload, null, 2));
  }

  public setSecret(key: string, value: string, providerHint?: string): VaultKeySummary {
    const cleanKey = key.trim();
    if (!/^[A-Z0-9_]{2,64}$/i.test(cleanKey)) {
      throw new Error(`Invalid secret key name "${key}". Use alphanumeric/underscore characters.`);
    }
    if (!value || !value.trim()) {
      throw new Error("Secret value cannot be empty.");
    }

    const masterKey = this.keyProvider.getOrCreateKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
    cipher.setAAD(Buffer.from(cleanKey, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const updatedAt = new Date().toISOString();

    this.entries[cleanKey] = {
      ivB64: iv.toString("base64"),
      tagB64: tag.toString("base64"),
      cipherB64: ciphertext.toString("base64"),
      maskedValue: maskSecretValue(value),
      providerHint,
      updatedAt,
    };
    this.save();

    return {
      key: cleanKey,
      maskedValue: this.entries[cleanKey]!.maskedValue,
      providerHint,
      updatedAt,
    };
  }

  public getSecret(key: string): string | null {
    const entry = this.entries[key];
    if (!entry) {
      return null;
    }
    const masterKey = this.keyProvider.getOrCreateKey();
    const iv = Buffer.from(entry.ivB64, "base64");
    const tag = Buffer.from(entry.tagB64, "base64");
    const ciphertext = Buffer.from(entry.cipherB64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAAD(Buffer.from(key, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  public resolveSecret(key: string): string | null {
    return this.getSecret(key) ?? (process.env[key]?.trim() || null);
  }

  public hasSecret(key: string): boolean {
    return Boolean(this.resolveSecret(key));
  }

  public deleteSecret(key: string): boolean {
    if (!this.entries[key]) {
      return false;
    }
    delete this.entries[key];
    this.save();
    return true;
  }

  public listKeys(): VaultKeySummary[] {
    return Object.entries(this.entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => ({
        key,
        maskedValue: entry.maskedValue,
        providerHint: entry.providerHint,
        updatedAt: entry.updatedAt,
      }));
  }
}
