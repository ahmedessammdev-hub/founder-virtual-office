import { normalizeForSearch, type MemoryEntry } from "@virtual-office/shared";

const NEGATION_CUES = new Set(
  [
    "لا",
    "ممنوع",
    "توقف",
    "ايقاف",
    "الغاء",
    "ليس",
    "غير مسموح",
    "بدلا من",
    "بدون",
    "احذر",
    "never",
    "do not",
    "dont",
    "forbid",
    "forbidden",
    "disable",
    "disabled",
    "deprecated",
    "instead of",
    "must not",
    "no longer",
    "false",
    "stop",
    "avoid",
    "prohibit",
    "prohibited",
    "remove",
    "removed",
  ].map((s) => normalizeForSearch(s)),
);

const ASSERTION_CUES = new Set(
  [
    "دائما",
    "يجب",
    "مسموح",
    "مفعل",
    "الافتراضي",
    "اعتمد",
    "استخدم",
    "always",
    "must",
    "required",
    "enable",
    "enabled",
    "default",
    "true",
    "allow",
    "allowed",
    "use",
  ].map((s) => normalizeForSearch(s)),
);

const STOP_WORDS = new Set(
  [
    "في",
    "من",
    "الي",
    "علي",
    "عن",
    "مع",
    "هو",
    "هي",
    "هذا",
    "هذه",
    "ذلك",
    "او",
    "ان",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "are",
    "was",
    "will",
    "all",
    "any",
  ].map((s) => normalizeForSearch(s)),
);

function tokenize(raw: string): Set<string> {
  const norm = normalizeForSearch(raw);
  const parts = norm
    .split(/[\s.,;:!?()[\]{}"'`،؛؟/\\-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !STOP_WORDS.has(p));
  return new Set(parts);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function hasCue(raw: string, cueSet: Set<string>): boolean {
  const norm = normalizeForSearch(raw);
  const tokens = norm.split(/[\s.,;:!?()[\]{}"'`،؛؟/\\-]+/);
  for (const cue of cueSet) {
    if (cue.includes(" ")) {
      if (norm.includes(cue)) return true;
    } else if (tokens.includes(cue)) {
      return true;
    }
  }
  return false;
}

function extractNumbers(raw: string): string[] {
  const matches = normalizeForSearch(raw).match(/\b\d+(?:\.\d+)?\b/g);
  return matches ? Array.from(new Set(matches)).sort() : [];
}

/**
 * Computes age-weighted decay score in [floor, 1.0]:
 * - Verified human semantic/procedural principles decay very slowly with a high floor (0.55).
 * - Unverified/working notes decay noticeably faster (floor 0.10) unless refreshed by access.
 * - Tool-verified episodic/semantic notes decay at the configured half-life (floor 0.15).
 */
export function computeEffectiveDecay(
  entry: Pick<MemoryEntry, "memoryType" | "verifiedBy" | "createdAt" | "lastAccessedAt">,
  halfLifeDays = 60,
  nowMs = Date.now(),
): number {
  const createdMs = Date.parse(entry.createdAt);
  const accessedMs = Date.parse(entry.lastAccessedAt);
  const referenceMs = Math.max(
    Number.isFinite(createdMs) ? createdMs : 0,
    Number.isFinite(accessedMs) ? accessedMs : 0,
  );
  const ageDays = referenceMs > 0 ? Math.max(0, (nowMs - referenceMs) / 86_400_000) : 0;

  let effectiveHalfLife = halfLifeDays;
  let floor = 0.15;

  if (
    entry.verifiedBy === "human" &&
    (entry.memoryType === "semantic" || entry.memoryType === "procedural")
  ) {
    effectiveHalfLife = halfLifeDays * 2;
    floor = 0.55;
  } else if (entry.memoryType === "working" || entry.verifiedBy === "unverified") {
    effectiveHalfLife = Math.max(7, halfLifeDays * 0.25);
    floor = 0.1;
  }

  const raw = Math.pow(0.5, ageDays / Math.max(1, effectiveHalfLife));
  return Number(Math.min(1, Math.max(floor, raw)).toFixed(4));
}

export interface ConflictDetectionResult {
  conflictingEntry: MemoryEntry;
  reason: string;
}

/**
 * Checks whether a candidate memory note contradicts any existing verified high-confidence
 * active memory in the exact same `(scope, projectId, employeeId)` isolation bucket.
 */
export function detectMemoryConflict(
  candidate: Pick<
    MemoryEntry,
    "id" | "scope" | "projectId" | "employeeId" | "title" | "content" | "supersedesId"
  >,
  existingActiveEntries: MemoryEntry[],
): ConflictDetectionResult | null {
  const candTitleTokens = tokenize(candidate.title);
  const candBodyTokens = tokenize(candidate.content);
  const candCombinedTokens = new Set([...candTitleTokens, ...candBodyTokens]);
  const candFullText = `${candidate.title}\n${candidate.content}`;
  const candHasNeg = hasCue(candFullText, NEGATION_CUES);
  const candHasAssert = hasCue(candFullText, ASSERTION_CUES);
  const candNums = extractNumbers(candFullText);

  for (const existing of existingActiveEntries) {
    if (existing.id === candidate.id) continue;
    if (candidate.supersedesId && candidate.supersedesId === existing.id) continue;
    if (existing.status !== "active") continue;
    if (existing.scope !== candidate.scope) continue;
    if ((existing.projectId ?? null) !== (candidate.projectId ?? null)) continue;
    if ((existing.employeeId ?? null) !== (candidate.employeeId ?? null)) continue;
    if (existing.verifiedBy === "unverified" || existing.confidence < 0.7) continue;

    const exTitleTokens = tokenize(existing.title);
    const exBodyTokens = tokenize(existing.content);
    const exCombinedTokens = new Set([...exTitleTokens, ...exBodyTokens]);

    const combinedOverlap = jaccard(candCombinedTokens, exCombinedTokens);
    // Near-duplicate restatements are not conflicts
    if (combinedOverlap >= 0.88) {
      continue;
    }

    const titleOverlap = jaccard(candTitleTokens, exTitleTokens);
    const bodyOverlap = jaccard(candBodyTokens, exBodyTokens);
    const topicalMatch = titleOverlap >= 0.5 || combinedOverlap >= 0.32;
    if (!topicalMatch) {
      continue;
    }

    const exFullText = `${existing.title}\n${existing.content}`;
    const exHasNeg = hasCue(exFullText, NEGATION_CUES);
    const exHasAssert = hasCue(exFullText, ASSERTION_CUES);

    if (candHasNeg !== exHasNeg && (candHasNeg || exHasNeg || candHasAssert || exHasAssert)) {
      return {
        conflictingEntry: existing,
        reason: `Polarity/rule contradiction with verified "${existing.title}" (${existing.id}).`,
      };
    }

    const exNums = extractNumbers(exFullText);
    if (
      candNums.length > 0 &&
      exNums.length > 0 &&
      JSON.stringify(candNums) !== JSON.stringify(exNums)
    ) {
      return {
        conflictingEntry: existing,
        reason: `Divergent numeric rule vs "${existing.title}" (${exNums.join(", ")} vs ${candNums.join(", ")}).`,
      };
    }

    if (titleOverlap >= 0.75 && bodyOverlap < 0.45) {
      return {
        conflictingEntry: existing,
        reason: `Divergent directive on the same topic as verified "${existing.title}" (${existing.id}).`,
      };
    }
  }

  return null;
}
