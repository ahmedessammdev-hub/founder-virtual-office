import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeServer, type OfficeAppContext } from "../src/api/server.js";
import { createTempOfficeDirs } from "./helpers/temp-office.js";

describe("Phase 6 Git Snapshot Backup, Safe Restore & Secret-Free Export", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function bootServer(): Promise<{ ctx: OfficeAppContext; baseUrl: string }> {
    const tmp = createTempOfficeDirs();
    const ctx = await createOfficeServer({
      companyRoot: tmp.companyRoot,
      dataDir: tmp.dataDir,
      enableWatcher: false,
      enableAutomationPollers: false,
      probeProvidersOnBoot: false,
    });
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const addr = ctx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    cleanups.push(async () => {
      await ctx.close();
      tmp.cleanup();
    });
    return { ctx, baseUrl: `http://127.0.0.1:${port}` };
  }

  it("initializes company Git backup, snapshots changes, inspects diff, restores non-destructively, and excludes secrets", async () => {
    const { ctx, baseUrl } = await bootServer();
    const initialTheme = ctx.companyStore.getCompanyConfig().floorplan.theme;
    const authHeader = { Authorization: `Bearer ${ctx.auth.sessionToken}` };
    const jsonHeaders = { ...authHeader, "Content-Type": "application/json" };

    // 1. Starts uninitialized
    const initStatus = (await (
      await fetch(`${baseUrl}/api/backup/status`, { headers: authHeader })
    ).json()) as { status: { initialized: boolean; commits: unknown[] } };
    expect(initStatus.status.initialized).toBe(false);
    expect(initStatus.status.commits).toHaveLength(0);

    // 2. Initialize Git repo -> creates initial snapshot commit
    const initResp = await fetch(`${baseUrl}/api/backup/init`, {
      method: "POST",
      headers: authHeader,
    });
    expect(initResp.status).toBe(200);
    const { status: afterInit } = (await initResp.json()) as {
      status: { initialized: boolean; headHash: string; commits: Array<{ hash: string }> };
    };
    expect(afterInit.initialized).toBe(true);
    expect(afterInit.commits).toHaveLength(1);
    const initialCommit = afterInit.headHash;
    expect(initialCommit).toMatch(/^[0-9a-f]{40}$/);

    // 3. Ignored secret files (.env.local) must NOT trigger dirty state or enter snapshots/export
    fs.writeFileSync(
      path.join(ctx.companyStore.companyRoot, ".env.local"),
      "SUPER_SECRET_BACKUP_TEST=should_never_leak",
      "utf8",
    );
    const noOpSnap = (await (
      await fetch(`${baseUrl}/api/backup/snapshot`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Should be skipped because secret is gitignored" }),
      })
    ).json()) as { created: boolean };
    expect(noOpSnap.created).toBe(false);

    // 4. Make a committed change: switch theme + add a tracked note
    await fetch(`${baseUrl}/api/company/floorplan`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ theme: "blueprint_slate" }),
    });
    const addedLaterPath = path.join(ctx.companyStore.companyRoot, "memory", "added-later.md");
    fs.writeFileSync(addedLaterPath, "# Added after initial snapshot\n", "utf8");

    const snap2Resp = await fetch(`${baseUrl}/api/backup/snapshot`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ message: "Blueprint slate & extra note" }),
    });
    expect(snap2Resp.status).toBe(200);
    const snap2Body = (await snap2Resp.json()) as {
      created: boolean;
      status: { commits: Array<{ message: string }> };
    };
    expect(snap2Body.created).toBe(true);
    expect(snap2Body.status.commits).toHaveLength(2);

    // 5. Make uncommitted changes -> inspect diff -> restore back to initialCommit non-destructively
    const cfgPath = path.join(ctx.companyStore.companyRoot, "company.json");
    const dirtyCfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as { name: string };
    dirtyCfg.name = "Unsaved Working Tree Edit";
    fs.writeFileSync(cfgPath, JSON.stringify(dirtyCfg, null, 2), "utf8");

    const untrackedPath = path.join(ctx.companyStore.companyRoot, "memory", "untracked-scratch.md");
    fs.writeFileSync(untrackedPath, "Temporary scratch", "utf8");

    const diffResp = await fetch(`${baseUrl}/api/backup/diff`, { headers: authHeader });
    expect(diffResp.status).toBe(200);
    const diffBody = (await diffResp.json()) as { diff: string };
    expect(diffBody.diff).toContain("Unsaved Working Tree Edit");

    const restoreResp = await fetch(`${baseUrl}/api/backup/restore`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ commitHash: initialCommit }),
    });
    expect(restoreResp.status).toBe(200);
    const restoreBody = (await restoreResp.json()) as {
      restoredFrom: string;
      preRestoreCommitHash: string | null;
      status: { commits: Array<{ message: string }> };
    };
    expect(restoreBody.restoredFrom).toBe(initialCommit);
    expect(restoreBody.preRestoreCommitHash).toBeTruthy();
    expect(
      restoreBody.status.commits.some((c) => c.message.startsWith("Pre-restore safety snapshot")),
    ).toBe(true);

    // Restored disk state & companyStore match initial snapshot cleanly
    expect(fs.existsSync(addedLaterPath)).toBe(false);
    expect(fs.existsSync(untrackedPath)).toBe(false);
    expect(ctx.companyStore.getCompanyConfig().name).toBe("Founder Virtual Office");
    expect(ctx.companyStore.getCompanyConfig().floorplan.theme).toBe(initialTheme);

    // 6. Export bundle omits .git and .env.local secrets
    const exportResp = await fetch(`${baseUrl}/api/backup/export`, { headers: authHeader });
    expect(exportResp.status).toBe(200);
    const bundleText = await exportResp.text();
    expect(bundleText).not.toContain("SUPER_SECRET_BACKUP_TEST");
    const bundle = JSON.parse(bundleText) as { files: Array<{ path: string }> };
    expect(bundle.files.some((f) => f.path === "company.json")).toBe(true);
    expect(bundle.files.some((f) => f.path.startsWith(".git/") || f.path.startsWith(".env"))).toBe(
      false,
    );
  });
});
