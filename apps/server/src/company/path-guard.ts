import fs from "node:fs";
import path from "node:path";
import { isSensitiveFilePath } from "@virtual-office/shared";

export class PathAccessError extends Error {
  public readonly code: "PATH_OUTSIDE_ROOT" | "SENSITIVE_FILE_BLOCKED";

  constructor(code: "PATH_OUTSIDE_ROOT" | "SENSITIVE_FILE_BLOCKED", message: string) {
    super(message);
    this.name = "PathAccessError";
    this.code = code;
  }
}

function normalizeForPlatformComparison(p: string): string {
  const normalized = path.normalize(p);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Resolves the canonical realpath for an existing path, or for a non-existent path
 * resolves its nearest existing ancestor directory and appends the remaining segments.
 * This defeats `..` traversal AND symlinks / Windows NTFS junctions escaping a root.
 */
export function resolveCanonicalPath(targetPath: string): string {
  const abs = path.resolve(targetPath);
  if (fs.existsSync(abs)) {
    return fs.realpathSync.native(abs);
  }

  const missingSegments: string[] = [];
  let current = abs;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return abs;
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  const realAncestor = fs.realpathSync.native(current);
  return path.join(realAncestor, ...missingSegments);
}

/**
 * Verifies that `targetPath` canonically resides inside at least one of `allowedRoots`.
 */
export function assertPathWithinRoots(targetPath: string, allowedRoots: string[]): string {
  if (allowedRoots.length === 0) {
    throw new PathAccessError("PATH_OUTSIDE_ROOT", "No allowed root directories configured.");
  }

  const canonicalTarget = resolveCanonicalPath(targetPath);
  const cmpTarget = normalizeForPlatformComparison(canonicalTarget);

  for (const root of allowedRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const canonicalRoot = fs.realpathSync.native(path.resolve(root));
    const cmpRoot = normalizeForPlatformComparison(canonicalRoot);
    const rootWithSep = cmpRoot.endsWith(path.sep) ? cmpRoot : `${cmpRoot}${path.sep}`;

    if (cmpTarget === cmpRoot || cmpTarget.startsWith(rootWithSep)) {
      return canonicalTarget;
    }
  }

  throw new PathAccessError(
    "PATH_OUTSIDE_ROOT",
    `Access denied: path "${targetPath}" escapes allowed workspace roots.`,
  );
}

/**
 * Enforces both root containment AND sensitive file blocklist (.env, private keys, credentials)
 * unless the exact canonical path has been unlocked via an explicit Tier 3 approval.
 */
export function assertReadableProjectFile(
  targetPath: string,
  allowedRoots: string[],
  unlockedCanonicalPaths: Set<string> = new Set(),
): string {
  const canonical = assertPathWithinRoots(targetPath, allowedRoots);
  if (isSensitiveFilePath(canonical)) {
    const cmp = normalizeForPlatformComparison(canonical);
    const normalizedUnlocked = new Set(
      Array.from(unlockedCanonicalPaths).map((p) => normalizeForPlatformComparison(p)),
    );
    if (!normalizedUnlocked.has(cmp)) {
      throw new PathAccessError(
        "SENSITIVE_FILE_BLOCKED",
        `Access denied: sensitive file "${path.basename(canonical)}" requires Tier 3 approval.`,
      );
    }
  }
  return canonical;
}
