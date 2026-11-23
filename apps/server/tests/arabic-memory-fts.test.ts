import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeForSearch } from "@virtual-office/shared";
import { OfficeDatabase } from "../src/db/database.js";
import { MemoryRepository } from "../src/db/repositories/memory-repo.js";
import { MemoryIndexer } from "../src/company/memory-indexer.js";
import { atomicWriteFile } from "../src/company/atomic-fs.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Arabic/English FTS5 Normalization & Memory Scope Isolation", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("normalizes Arabic diacritics, tatweel, alef/teh/yeh variants, and English casing", () => {
    const raw = "إِسْتْرَاتِيجِيَّةُ الإطلاق — التَّسْوِيقُ بِالْكَامِلِ TypeScript";
    const normalized = normalizeForSearch(raw);
    expect(normalized).toBe("استراتيجيه الاطلاق — التسويق بالكامل typescript");
    expect(normalizeForSearch("أحمد إسلام آمنة على مكتبة")).toBe("احمد اسلام امنه علي مكتبه");
  });

  it("indexes Markdown memory files into FTS5, matches unnormalized Arabic queries, and skips unchanged files", () => {
    const tmp = createTempOfficeDirs();
    const db = new OfficeDatabase(":memory:");
    cleanups.push(() => {
      db.close();
      tmp.cleanup();
    });

    const memoryRepo = new MemoryRepository(db.db);
    const indexer = new MemoryIndexer(tmp.companyRoot, memoryRepo);

    const launchNote = path.join(tmp.companyRoot, "memory", "launch-strategy.md");
    atomicWriteFile(
      launchNote,
      `---
id: company-launch-strategy
scope: company
memoryType: semantic
title: خطة الإطلاق الأولى
confidence: 0.9
verifiedBy: human
---
إِسْتْرَاتِيجِيَّةُ الإطلاقِ تعتمد على جودة المنتج وسرعة التنفيذ.
`,
    );

    const firstSync = indexer.syncAll();
    expect(firstSync.indexed).toBeGreaterThanOrEqual(2);

    // Second sync with unchanged files must skip via SHA-256 cache
    const secondSync = indexer.syncAll();
    expect(secondSync.indexed).toBe(0);
    expect(secondSync.skipped).toBeGreaterThanOrEqual(2);

    // Query without hamzas / teh marbuta / diacritics matches original Arabic text
    const hits = memoryRepo.search({ q: "استراتيجيه الاطلاق" });
    expect(hits.some((m) => m.id === "company-launch-strategy")).toBe(true);
  });

  it("isolates project and employee memory scopes strictly", () => {
    const tmp = createTempOfficeDirs();
    const db = new OfficeDatabase(":memory:");
    cleanups.push(() => {
      db.close();
      tmp.cleanup();
    });

    const memoryRepo = new MemoryRepository(db.db);
    const indexer = new MemoryIndexer(tmp.companyRoot, memoryRepo);

    atomicWriteFile(
      path.join(tmp.companyRoot, "projects", "alpha", "memory", "secret-alpha.md"),
      `---
id: proj-alpha-note
scope: project
projectId: alpha
memoryType: semantic
title: Alpha Architecture
confidence: 0.9
verifiedBy: tool_output
---
Keyword zetaalpha project alpha architectural secret.
`,
    );

    atomicWriteFile(
      path.join(tmp.companyRoot, "projects", "beta", "memory", "secret-beta.md"),
      `---
id: proj-beta-note
scope: project
projectId: beta
memoryType: semantic
title: Beta Architecture
confidence: 0.9
verifiedBy: tool_output
---
Keyword zetaalpha project beta architectural secret.
`,
    );

    indexer.syncAll();

    // Searching as senior-engineer on project `alpha` must return alpha + company, NEVER beta or other employees' memory
    const alphaResults = memoryRepo.search({
      q: "zetaalpha",
      forEmployeeId: "senior-engineer",
      forProjectId: "alpha",
    });
    expect(alphaResults.map((r) => r.id)).toEqual(["proj-alpha-note"]);

    // Searching as senior-engineer for general-manager note must isolate employee memory
    const gmCheck = memoryRepo.search({
      q: "سقف التوازي",
      forEmployeeId: "senior-engineer",
      forProjectId: null,
    });
    expect(gmCheck.some((r) => r.employeeId === "general-manager")).toBe(false);
  });
});
