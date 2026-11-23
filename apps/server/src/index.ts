import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOfficeServer } from "./api/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const companyRoot = process.env.OFFICE_COMPANY_ROOT ?? path.join(repoRoot, "company");
const dataDir = process.env.OFFICE_DATA_DIR ?? path.join(repoRoot, "data");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4310);

async function main(): Promise<void> {
  const ctx = await createOfficeServer({
    companyRoot,
    dataDir,
    enableWatcher: true,
    enableAutomationPollers: true,
    probeProvidersOnBoot: true,
    webDistDir: path.join(repoRoot, "apps", "web", "dist"),
  });

  await ctx.app.listen({ host, port });
  const address = ctx.app.server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  ctx.officeMcpUrlRef.url = `http://${host}:${actualPort}/mcp`;

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "runtime.json"),
    JSON.stringify(
      {
        host,
        port: actualPort,
        token: ctx.auth.sessionToken,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify({
      status: "listening",
      url: `http://${host}:${actualPort}`,
      employees: ctx.companyStore.listEmployees().length,
      projects: ctx.companyStore.listProjects().length,
    }),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Shutting down (${signal})...`);
    await ctx.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
