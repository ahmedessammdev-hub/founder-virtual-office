import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  MemoryCitationSchema,
  MemoryScopeSchema,
  MemoryStatusSchema,
  MemoryTypeSchema,
  MemoryVerificationSchema,
  type MemoryEntry,
} from "@virtual-office/shared";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";
import { computeEffectiveDecay } from "../memory/decay-and-conflict.js";
import { sha256File } from "./atomic-fs.js";

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return { frontmatter: {}, body: trimmed.trim() };
  }
  const parsed = parseYaml(match[1] ?? "");
  return {
    frontmatter: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    body: (match[2] ?? "").trim(),
  };
}

function inferScopeFromPath(
  companyRoot: string,
  filePath: string,
): { scope: "company" | "project" | "employee"; projectId: string | null; employeeId: string | null } {
  const rel = path.relative(companyRoot, filePath).replace(/\\/g, "/");
  const empMatch = /^employees\/([^/]+)\/memory\//.exec(rel);
  if (empMatch) {
    return { scope: "employee", projectId: null, employeeId: empMatch[1] ?? null };
  }
  const projMatch = /^projects\/([^/]+)\/memory\//.exec(rel);
  if (projMatch) {
    return { scope: "project", projectId: projMatch[1] ?? null, employeeId: null };
  }
  return { scope: "company", projectId: null, employeeId: null };
}

function walkMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

export class MemoryIndexer {
  constructor(
    private readonly companyRoot: string,
    private readonly memoryRepo: MemoryRepository,
  ) {}

  public discoverMemoryFiles(): string[] {
    const files: string[] = [];
    files.push(...walkMarkdownFiles(path.join(this.companyRoot, "memory")));

    const employeesDir = path.join(this.companyRoot, "employees");
    if (fs.existsSync(employeesDir)) {
      for (const entry of fs.readdirSync(employeesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          files.push(...walkMarkdownFiles(path.join(employeesDir, entry.name, "memory")));
        }
      }
    }

    const projectsDir = path.join(this.companyRoot, "projects");
    if (fs.existsSync(projectsDir)) {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          files.push(...walkMarkdownFiles(path.join(projectsDir, entry.name, "memory")));
        }
      }
    }

    return files;
  }

  /**
   * Re-indexes changed Markdown files into SQLite + FTS5 based on SHA-256 hashes,
   * removing any deleted files from the index.
   */
  public syncAll(): { indexed: number; skipped: number; removed: number } {
    const discovered = this.discoverMemoryFiles();
    const discoveredSet = new Set(discovered.map((f) => path.resolve(f)));

    let indexed = 0;
    let skipped = 0;
    let removed = 0;

    for (const filePath of discovered) {
      const changed = this.indexSingleFile(filePath);
      if (changed) {
        indexed += 1;
      } else {
        skipped += 1;
      }
    }

    for (const oldPath of this.memoryRepo.listIndexedFilePaths()) {
      if (!discoveredSet.has(path.resolve(oldPath))) {
        this.memoryRepo.removeByFilePath(oldPath);
        removed += 1;
      }
    }

    return { indexed, skipped, removed };
  }

  public indexSingleFile(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      this.memoryRepo.removeByFilePath(resolved);
      return true;
    }

    const hash = sha256File(resolved);
    const existingHash = this.memoryRepo.getIndexedFileHash(resolved);
    if (existingHash === hash) {
      return false;
    }

    const raw = fs.readFileSync(resolved, "utf8");
    const { frontmatter, body } = splitFrontmatter(raw);
    const inferred = inferScopeFromPath(this.companyRoot, resolved);

    const parsedScope = MemoryScopeSchema.safeParse(frontmatter.scope);
    const scope = parsedScope.success ? parsedScope.data : inferred.scope;
    const parsedVerified = MemoryVerificationSchema.safeParse(frontmatter.verifiedBy);
    const verifiedBy = parsedVerified.success ? parsedVerified.data : "unverified";
    const parsedType = MemoryTypeSchema.safeParse(frontmatter.memoryType);
    const memoryType = parsedType.success
      ? parsedType.data
      : verifiedBy === "unverified"
        ? "working"
        : "semantic";
    const parsedStatus = MemoryStatusSchema.safeParse(frontmatter.status);
    const status = parsedStatus.success ? parsedStatus.data : "active";

    const citationsRaw = Array.isArray(frontmatter.sourceCitations) ? frontmatter.sourceCitations : [];
    const sourceCitations = citationsRaw
      .map((item) => MemoryCitationSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data);

    const relId = path
      .relative(this.companyRoot, resolved)
      .replace(/\\/g, "/")
      .replace(/\.md$/i, "");
    const id = typeof frontmatter.id === "string" && frontmatter.id.trim() ? frontmatter.id.trim() : relId;
    const title =
      typeof frontmatter.title === "string" && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : path.basename(resolved, ".md");

    const now = new Date().toISOString();
    const createdAt = typeof frontmatter.createdAt === "string" ? frontmatter.createdAt : now;
    const lastAccessedAt =
      typeof frontmatter.lastAccessedAt === "string" ? frontmatter.lastAccessedAt : now;
    const confidenceNum = Number(frontmatter.confidence ?? (verifiedBy === "unverified" ? 0.4 : 0.9));
    const hasExplicitDecay =
      frontmatter.decayScore !== undefined && Number.isFinite(Number(frontmatter.decayScore));
    const decayNum = hasExplicitDecay
      ? Number(frontmatter.decayScore)
      : computeEffectiveDecay({
          memoryType,
          verifiedBy,
          createdAt,
          lastAccessedAt,
        });

    const entry: MemoryEntry = {
      id,
      scope,
      projectId:
        typeof frontmatter.projectId === "string" ? frontmatter.projectId : inferred.projectId,
      employeeId:
        typeof frontmatter.employeeId === "string" ? frontmatter.employeeId : inferred.employeeId,
      memoryType,
      title,
      content: body,
      sourceCitations,
      confidence: Number.isFinite(confidenceNum) ? Math.min(Math.max(confidenceNum, 0), 1) : 0.5,
      verifiedBy,
      createdAt,
      lastAccessedAt,
      decayScore: Number.isFinite(decayNum) ? Math.min(Math.max(decayNum, 0), 1) : 1.0,
      supersedesId: typeof frontmatter.supersedesId === "string" ? frontmatter.supersedesId : null,
      taintedByExternalInput: Boolean(frontmatter.taintedByExternalInput),
      status,
      conflictWithId:
        typeof frontmatter.conflictWithId === "string" ? frontmatter.conflictWithId : null,
      conflictReason:
        typeof frontmatter.conflictReason === "string" ? frontmatter.conflictReason : null,
      filePath: resolved,
    };

    this.memoryRepo.upsertIndexedEntry(entry, hash);
    return true;
  }
}
