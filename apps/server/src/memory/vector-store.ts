import type {
  MemoryEntry,
  MemoryPolicy,
  MemoryScope,
  MemorySearchMeta,
  MemoryStatus,
  MemoryType,
  VectorStatus,
} from "@virtual-office/shared";
import { sha256Text } from "../company/atomic-fs.js";
import type { MemoryRepository } from "../db/repositories/memory-repo.js";

export interface EmbeddingProvider {
  embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]>;
  isReachable?(model?: string): Promise<boolean>;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:11434") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  public async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async embed(
    texts: string[],
    model: string,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const timeoutSig = AbortSignal.timeout(6_000);
    const mergedSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

    // Try modern Ollama `/api/embed` batch endpoint first
    const embedRes = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: mergedSignal,
      body: JSON.stringify({ model, input: texts }),
    });

    if (embedRes.ok) {
      const data = (await embedRes.json()) as { embeddings?: number[][] };
      if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) {
        return data.embeddings;
      }
      throw new Error("Ollama /api/embed returned unexpected payload shape.");
    }

    if (embedRes.status !== 404 && embedRes.status !== 405) {
      const errText = await embedRes.text().catch(() => "");
      throw new Error(`Ollama /api/embed failed (HTTP ${embedRes.status}): ${errText.slice(0, 200)}`);
    }

    // Legacy fallback `/api/embeddings` per item
    const vectors: number[][] = [];
    for (const text of texts) {
      const legacyRes = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: mergedSignal,
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!legacyRes.ok) {
        const errText = await legacyRes.text().catch(() => "");
        throw new Error(
          `Ollama /api/embeddings failed (HTTP ${legacyRes.status}): ${errText.slice(0, 200)}`,
        );
      }
      const data = (await legacyRes.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding)) {
        throw new Error("Ollama /api/embeddings returned missing embedding array.");
      }
      vectors.push(data.embedding);
    }
    return vectors;
  }
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

export class VectorStore {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly customProvider?: EmbeddingProvider,
  ) {}

  private resolveProvider(policy: MemoryPolicy): EmbeddingProvider {
    return this.customProvider ?? new OllamaEmbeddingProvider(policy.ollamaBaseUrl);
  }

  public async getStatus(policy: MemoryPolicy): Promise<VectorStatus> {
    const active = this.memoryRepo.listAllActive();
    const stats = this.memoryRepo.countVectors(policy.embeddingModel);
    const provider = this.resolveProvider(policy);
    const reachable = provider.isReachable
      ? await provider.isReachable(policy.embeddingModel).catch(() => false)
      : true;

    let status: VectorStatus["status"] = "disabled";
    if (policy.vectorEnabled) {
      if (!reachable) {
        status = "ollama_unreachable";
      } else if (stats.count < active.length) {
        status = "needs_sync";
      } else {
        status = "ready";
      }
    }

    return {
      enabled: policy.vectorEnabled,
      provider: policy.embeddingProvider,
      model: policy.embeddingModel,
      ollamaBaseUrl: policy.ollamaBaseUrl,
      ollamaReachable: reachable,
      indexedCount: stats.count,
      totalActiveCount: active.length,
      dimensions: stats.dimensions,
      status,
    };
  }

  public async embedEntry(entry: MemoryEntry, policy: MemoryPolicy): Promise<boolean> {
    if (!policy.vectorEnabled || entry.status !== "active") {
      return false;
    }
    const contentText = `${entry.title}\n${entry.content}`;
    const contentHash = sha256Text(contentText);
    const existingMeta = this.memoryRepo.getVectorMeta(entry.id);
    if (
      existingMeta &&
      existingMeta.model === policy.embeddingModel &&
      existingMeta.contentSha256 === contentHash
    ) {
      return false;
    }

    const provider = this.resolveProvider(policy);
    const [vec] = await provider.embed([contentText], policy.embeddingModel);
    if (!vec || vec.length === 0) {
      return false;
    }
    const floatVec = Float32Array.from(vec);
    this.memoryRepo.upsertVector(
      entry.id,
      policy.embeddingModel,
      floatVec.length,
      contentHash,
      floatVec,
    );
    return true;
  }

  public async syncEmbeddings(policy: MemoryPolicy): Promise<{
    embedded: number;
    skipped: number;
    failed: number;
    error?: string;
  }> {
    if (!policy.vectorEnabled) {
      return {
        embedded: 0,
        skipped: 0,
        failed: 0,
        error: "Vector retrieval is disabled in company memory settings.",
      };
    }

    this.memoryRepo.deleteVectorsByModelMismatch(policy.embeddingModel);
    const activeEntries = this.memoryRepo.listAllActive();
    const toEmbed: Array<{ entry: MemoryEntry; text: string; sha256: string }> = [];
    let skipped = 0;

    for (const entry of activeEntries) {
      const text = `${entry.title}\n${entry.content}`;
      const contentSha256 = sha256Text(text);
      const existing = this.memoryRepo.getVectorMeta(entry.id);
      if (
        existing &&
        existing.model === policy.embeddingModel &&
        existing.contentSha256 === contentSha256
      ) {
        skipped += 1;
      } else {
        toEmbed.push({ entry, text, sha256: contentSha256 });
      }
    }

    if (toEmbed.length === 0) {
      return { embedded: 0, skipped, failed: 0 };
    }

    const provider = this.resolveProvider(policy);
    let embedded = 0;
    let failed = 0;
    let lastError: string | undefined;

    const batchSize = 16;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      try {
        const vectors = await provider.embed(
          batch.map((item) => item.text),
          policy.embeddingModel,
        );
        for (let idx = 0; idx < batch.length; idx += 1) {
          const item = batch[idx]!;
          const rawVec = vectors[idx];
          if (!rawVec || rawVec.length === 0) {
            failed += 1;
            continue;
          }
          const floatVec = Float32Array.from(rawVec);
          this.memoryRepo.upsertVector(
            item.entry.id,
            policy.embeddingModel,
            floatVec.length,
            item.sha256,
            floatVec,
          );
          embedded += 1;
        }
      } catch (err) {
        failed += batch.length;
        lastError = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    return { embedded, skipped, failed, error: lastError };
  }

  /**
   * Executes strict scope-isolated FTS5 search and, if enabled and reachable,
   * fuses cosine similarity from SQLite BLOB embeddings without ever leaking
   * across project/employee boundaries or failing when Ollama is stopped.
   */
  public async hybridSearch(
    params: {
      q: string;
      scope?: MemoryScope;
      projectId?: string;
      employeeId?: string;
      forEmployeeId?: string;
      forProjectId?: string | null;
      status?: MemoryStatus;
      memoryType?: MemoryType;
      includeArchived?: boolean;
      limit?: number;
    },
    policy: MemoryPolicy,
  ): Promise<{ entries: MemoryEntry[]; meta: MemorySearchMeta }> {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
    const ftsEntries = this.memoryRepo.search({ ...params, limit: Math.max(limit * 2, 20) });

    if (!policy.vectorEnabled) {
      return {
        entries: ftsEntries.slice(0, limit),
        meta: { vectorUsed: false, vectorFallbackReason: "disabled" },
      };
    }

    if (!params.q.trim()) {
      return {
        entries: ftsEntries.slice(0, limit),
        meta: { vectorUsed: false },
      };
    }

    const scopedVectors = this.memoryRepo.listVectorsForScope({
      model: policy.embeddingModel,
      scope: params.scope,
      projectId: params.projectId,
      employeeId: params.employeeId,
      forEmployeeId: params.forEmployeeId,
      forProjectId: params.forProjectId,
      status: params.status,
      memoryType: params.memoryType,
      includeArchived: params.includeArchived,
    });

    if (scopedVectors.length === 0) {
      return {
        entries: ftsEntries.slice(0, limit),
        meta: { vectorUsed: false, vectorFallbackReason: "no_vectors_indexed" },
      };
    }

    let queryVec: Float32Array;
    try {
      const provider = this.resolveProvider(policy);
      const [embedded] = await provider.embed([params.q], policy.embeddingModel);
      if (!embedded || embedded.length === 0) {
        return {
          entries: ftsEntries.slice(0, limit),
          meta: { vectorUsed: false, vectorFallbackReason: "empty_query_embedding" },
        };
      }
      queryVec = Float32Array.from(embedded);
    } catch (err) {
      return {
        entries: ftsEntries.slice(0, limit),
        meta: {
          vectorUsed: false,
          vectorFallbackReason: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const ftsScoreMap = new Map<string, { entry: MemoryEntry; score: number }>();
    ftsEntries.forEach((entry, index) => {
      const rankScore = 1 - index / Math.max(1, ftsEntries.length);
      ftsScoreMap.set(entry.id, { entry, score: rankScore });
    });

    const vecScoreMap = new Map<string, { entry: MemoryEntry; score: number }>();
    for (const row of scopedVectors) {
      const rawCos = cosineSimilarity(queryVec, row.vector);
      const posCos = Math.max(0, rawCos);
      if (posCos > 0.1 || ftsScoreMap.has(row.entry.id)) {
        vecScoreMap.set(row.entry.id, { entry: row.entry, score: posCos });
      }
    }

    const allIds = new Set<string>([...ftsScoreMap.keys(), ...vecScoreMap.keys()]);
    const wFts = policy.ftsWeight;
    const wVec = policy.vectorWeight;
    const weightSum = wFts + wVec > 0 ? wFts + wVec : 1;

    const ranked: Array<{ entry: MemoryEntry; finalScore: number }> = [];
    for (const id of allIds) {
      const ftsHit = ftsScoreMap.get(id);
      const vecHit = vecScoreMap.get(id);
      const entry = ftsHit?.entry ?? vecHit?.entry;
      if (!entry) continue;

      const ftsScore = ftsHit?.score ?? 0;
      const vecScore = vecHit?.score ?? 0;
      const eff = entry.effectiveScore ?? entry.confidence * entry.decayScore;
      const fused = (wFts * ftsScore + wVec * vecScore) / weightSum;
      const finalScore = fused * (0.5 + 0.5 * eff);

      const retrievalMode: MemoryEntry["retrievalMode"] =
        ftsHit && vecHit && vecScore > 0.1
          ? "hybrid"
          : vecHit && !ftsHit
            ? "vector"
            : "fts";

      ranked.push({
        entry: { ...entry, retrievalMode },
        finalScore,
      });
    }

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    return {
      entries: ranked.slice(0, limit).map((item) => item.entry),
      meta: { vectorUsed: true },
    };
  }
}
