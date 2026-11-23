import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  CreateGitSnapshotInputSchema,
  RestoreGitSnapshotInputSchema,
  type GitBackupStatus,
  type GitCommitEntry,
} from "@virtual-office/shared";
import type { CompanyStore } from "../company/company-store.js";
import type { MemoryIndexer } from "../company/memory-indexer.js";
import type { AuditRepository } from "../db/repositories/audit-repo.js";

const execFileAsync = promisify(execFile);

const GIT_HASH_RE = /^[0-9a-fA-F]{7,40}$/;
const REQUIRED_GITIGNORE_ENTRIES = [
  "*.tmp",
  "*.tmp.*",
  ".env",
  ".env.*",
  "*.key",
  "*.enc.json",
  ".DS_Store",
  "Thumbs.db",
];
const MAX_EXPORT_FILE_BYTES = 512 * 1024;

export interface CompanyExportFile {
  path: string;
  sha256: string;
  bytes: number;
  content: string;
}

export interface CompanyExportBundle {
  exportedAt: string;
  companyName: string;
  fileCount: number;
  files: CompanyExportFile[];
}

/**
 * Git-backed snapshot, diff, safe restore, and portable export manager scoped strictly to `companyRoot`.
 * Never reads or exports CredentialVault secrets (`data/`).
 */
export class GitBackupManager {
  constructor(
    private readonly companyStore: CompanyStore,
    private readonly memoryIndexer: MemoryIndexer,
    private readonly auditRepo: AuditRepository,
  ) {}

  private get companyRoot(): string {
    return this.companyStore.companyRoot;
  }

  private async runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.companyRoot,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  }

  private async isInitialized(): Promise<boolean> {
    const gitDir = path.join(this.companyRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      return false;
    }
    try {
      const out = (await this.runGit(["rev-parse", "--is-inside-work-tree"])).trim();
      return out === "true";
    } catch {
      return false;
    }
  }

  private ensureGitIgnore(): void {
    const ignorePath = path.join(this.companyRoot, ".gitignore");
    const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : "";
    const existingLines = new Set(
      existing
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const additions = REQUIRED_GITIGNORE_ENTRIES.filter((line) => !existingLines.has(line));
    if (additions.length === 0 && fs.existsSync(ignorePath)) {
      return;
    }
    const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
    const nextContent = `${prefix}${additions.join("\n")}\n`;
    fs.writeFileSync(ignorePath, nextContent, "utf8");
  }

  public async getStatus(limit = 20): Promise<GitBackupStatus> {
    const initialized = await this.isInitialized();
    if (!initialized) {
      return {
        initialized: false,
        branch: null,
        headHash: null,
        dirtyCount: 0,
        changedFiles: [],
        commits: [],
      };
    }

    let branch: string | null = null;
    try {
      branch = (await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null;
    } catch {
      branch = null;
    }

    let headHash: string | null = null;
    try {
      headHash = (await this.runGit(["rev-parse", "HEAD"])).trim() || null;
    } catch {
      headHash = null;
    }

    const porcelain = await this.runGit(["status", "--porcelain=v1"]);
    const changedFiles = porcelain
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    const commits: GitCommitEntry[] = [];
    if (headHash) {
      const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
      const rawLog = await this.runGit([
        "log",
        `-n`,
        String(safeLimit),
        "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI",
      ]);
      for (const line of rawLog.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [hash, shortHash, message, author, dateIso] = line.split("\x1f");
        if (hash && shortHash) {
          commits.push({
            hash,
            shortHash,
            message: message ?? "",
            author: author ?? "",
            dateIso: dateIso ?? "",
          });
        }
      }
    }

    return {
      initialized: true,
      branch,
      headHash,
      dirtyCount: changedFiles.length,
      changedFiles,
      commits,
    };
  }

  public async initRepo(): Promise<GitBackupStatus> {
    const alreadyInit = await this.isInitialized();
    if (!alreadyInit) {
      try {
        await this.runGit(["init", "-b", "main"]);
      } catch {
        await this.runGit(["init"]);
        await this.runGit(["checkout", "-b", "main"]);
      }
      await this.runGit(["config", "--local", "user.name", "Virtual Office Founder"]);
      await this.runGit(["config", "--local", "user.email", "founder@virtual-office.local"]);
    }

    this.ensureGitIgnore();
    await this.runGit(["add", "-A"]);
    const statusOut = (await this.runGit(["status", "--porcelain=v1"])).trim();
    if (statusOut.length > 0) {
      await this.runGit(["commit", "-m", "Initial company snapshot"]);
    }

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "backup.git_init",
      targetType: "company_repo",
      targetId: "company",
      status: "OK",
    });

    return this.getStatus();
  }

  public async createSnapshot(rawMessage?: string): Promise<{
    created: boolean;
    commitHash: string | null;
    status: GitBackupStatus;
  }> {
    if (!(await this.isInitialized())) {
      throw new Error("Company Git backup repository is not initialized yet. Run init first.");
    }

    const parsed = CreateGitSnapshotInputSchema.parse({ message: rawMessage });
    this.ensureGitIgnore();
    await this.runGit(["add", "-A"]);
    const porcelain = (await this.runGit(["status", "--porcelain=v1"])).trim();
    if (!porcelain) {
      const currentStatus = await this.getStatus();
      return {
        created: false,
        commitHash: currentStatus.headHash,
        status: currentStatus,
      };
    }

    const commitMsg =
      parsed.message?.trim() || `Snapshot ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
    await this.runGit(["commit", "-m", commitMsg]);
    const status = await this.getStatus();

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "backup.snapshot_created",
      targetType: "git_commit",
      targetId: status.headHash,
      status: "OK",
      details: { message: commitMsg },
    });

    return {
      created: true,
      commitHash: status.headHash,
      status,
    };
  }

  public async getDiff(commitHash?: string): Promise<string> {
    if (!(await this.isInitialized())) {
      return "";
    }

    if (commitHash) {
      if (!GIT_HASH_RE.test(commitHash)) {
        throw new Error(`Invalid Git commit hash: "${commitHash}"`);
      }
      return this.runGit(["show", "--stat", "--patch", "--no-color", commitHash]);
    }

    let headDiff = "";
    try {
      headDiff = await this.runGit(["diff", "--no-color", "HEAD"]);
    } catch {
      headDiff = "";
    }
    const statusOut = (await this.runGit(["status", "--porcelain=v1"])).trim();
    if (!headDiff.trim() && statusOut) {
      return `# Pending working tree changes:\n${statusOut}`;
    }
    return headDiff;
  }

  public async restoreSnapshot(rawCommitHash: string): Promise<{
    restoredFrom: string;
    preRestoreCommitHash: string | null;
    newCommitHash: string | null;
    status: GitBackupStatus;
  }> {
    if (!(await this.isInitialized())) {
      throw new Error("Company Git backup repository is not initialized yet.");
    }

    const { commitHash } = RestoreGitSnapshotInputSchema.parse({ commitHash: rawCommitHash });
    try {
      await this.runGit(["cat-file", "-e", `${commitHash}^{commit}`]);
    } catch {
      throw new Error(`Commit "${commitHash}" was not found in company Git history.`);
    }

    // Safety net: snapshot dirty working tree before restoring
    let preRestoreCommitHash: string | null = null;
    const dirtyBefore = (await this.runGit(["status", "--porcelain=v1"])).trim();
    if (dirtyBefore) {
      await this.runGit(["add", "-A"]);
      await this.runGit([
        "commit",
        "-m",
        `Pre-restore safety snapshot before ${commitHash.slice(0, 7)}`,
      ]);
      preRestoreCommitHash = (await this.runGit(["rev-parse", "HEAD"])).trim();
    }

    // Clear current tracked files first so files introduced after target commit do not linger
    await this.runGit(["rm", "-rf", "--quiet", "--ignore-unmatch", "."]);
    // Restore files from target commit cleanly without rewriting history
    await this.runGit(["checkout", commitHash, "--", "."]);
    await this.runGit(["clean", "-fd", "-e", ".gitignore"]);
    this.ensureGitIgnore();
    await this.runGit(["add", "-A"]);

    const dirtyAfter = (await this.runGit(["status", "--porcelain=v1"])).trim();
    let newCommitHash: string | null = null;
    if (dirtyAfter) {
      await this.runGit(["commit", "-m", `Restore company snapshot from ${commitHash.slice(0, 7)}`]);
      newCommitHash = (await this.runGit(["rev-parse", "HEAD"])).trim();
    } else {
      newCommitHash = (await this.runGit(["rev-parse", "HEAD"])).trim();
    }

    this.companyStore.reloadAll();
    this.memoryIndexer.syncAll();

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "backup.restored",
      targetType: "git_commit",
      targetId: commitHash,
      status: "OK",
      details: { preRestoreCommitHash, newCommitHash },
    });

    return {
      restoredFrom: commitHash,
      preRestoreCommitHash,
      newCommitHash,
      status: await this.getStatus(),
    };
  }

  public buildExportBundle(): CompanyExportBundle {
    const files: CompanyExportFile[] = [];

    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        if (
          name === ".git" ||
          name === "node_modules" ||
          name.startsWith(".env") ||
          name.includes(".tmp.") ||
          name.endsWith(".tmp") ||
          name.endsWith(".key") ||
          name.endsWith(".enc.json") ||
          name === ".DS_Store" ||
          name === "Thumbs.db"
        ) {
          continue;
        }
        const full = path.join(dir, name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const stat = fs.statSync(full);
        if (stat.size > MAX_EXPORT_FILE_BYTES) {
          continue;
        }
        const raw = fs.readFileSync(full);
        const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
        files.push({
          path: path.relative(this.companyRoot, full).replace(/\\/g, "/"),
          sha256,
          bytes: stat.size,
          content: raw.toString("utf8"),
        });
      }
    };

    walk(this.companyRoot);
    files.sort((a, b) => a.path.localeCompare(b.path));

    this.auditRepo.log({
      actorType: "human",
      actorId: "founder",
      action: "backup.exported_bundle",
      targetType: "company_repo",
      targetId: "company",
      status: "OK",
      details: { fileCount: files.length },
    });

    return {
      exportedAt: new Date().toISOString(),
      companyName: this.companyStore.getCompanyConfig().name,
      fileCount: files.length,
      files,
    };
  }
}
