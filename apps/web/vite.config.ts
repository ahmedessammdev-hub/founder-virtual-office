import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeJsonPath = path.resolve(__dirname, "../../data/runtime.json");

function readRuntimeMeta(): { host: string; port: number; token: string } | null {
  try {
    if (!fs.existsSync(runtimeJsonPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(runtimeJsonPath, "utf8")) as {
      host?: string;
      port?: number;
      token?: string;
    };
    if (!parsed.token || !parsed.port) {
      return null;
    }
    return {
      host: parsed.host ?? "127.0.0.1",
      port: Number(parsed.port),
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

/**
 * Localhost-only session bridge that supplies the active backend Bearer token from
 * `data/runtime.json` without exposing credentials in static source files.
 */
function officeLocalSessionPlugin(): Plugin {
  return {
    name: "office-local-session-bridge",
    configureServer(server) {
      server.middlewares.use("/__office_session", (req, res) => {
        const host = req.headers.host ?? "";
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "Forbidden host" }));
          return;
        }
        const meta = readRuntimeMeta();
        if (!meta) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Office server runtime.json not ready" }));
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ token: meta.token, port: meta.port }));
      });
    },
  };
}

const initialRuntime = readRuntimeMeta();
const apiPort = initialRuntime?.port ?? Number(process.env.OFFICE_API_PORT ?? 4310);

export default defineConfig({
  plugins: [react(), officeLocalSessionPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/company-assets": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, "/");
          if (
            norm.includes("/node_modules/react/") ||
            norm.includes("/node_modules/react-dom/") ||
            norm.includes("/node_modules/scheduler/") ||
            norm.includes("/node_modules/zustand/")
          ) {
            return "vendor-react";
          }
          if (norm.includes("/node_modules/three/")) {
            return "vendor-three";
          }
          return undefined;
        },
      },
    },
  },
});
