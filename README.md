# Founder Virtual Office (`المكتب الافتراضي للمؤسس`)

A local-first, bilingual (Arabic RTL + English LTR) multi-runtime AI Company Operating System built with TypeScript, Fastify, `node:sqlite` (WAL + FTS5), React 19, Vite, and Zustand.

---

## Architecture Overview

| Layer | Responsibility | Key Location |
| :--- | :--- | :--- |
| **Shared Contracts** | Zod schemas for Employees, Runs, Approvals, Memory, Orchestration DAGs, Hiring, Automation Cron/Telegram, and Floorplan Themes/Analytics | [packages/shared/src](packages/shared/src) |
| **Company SSOT** | Git-friendly declarative YAML/Markdown definitions (`company.json`, `employees/`, `memory/`, `projects/`, `deliverables/`) watched via Chokidar | [company/](company/) |
| **Server & Runtime** | Fastify HTTP/WS server, `JobSupervisor`, Multi-Runtime adapters (`agy`, `codex`, `claude`, Direct APIs, `ollama`, `mock`, `dry_run`), 3-Tier Policy Guard, Encrypted `CredentialVault`, `office-mcp` Bridge, External MCP Manager, Memory & Learning Pipeline, DAG/Meeting/Hiring Engines, Cron Scheduler, Telegram Bridge, `AnalyticsService`, `GitBackupManager` | [apps/server/src](apps/server/src) |
| **Web Studio UI** | Executive Obsidian Dark + Warm Daylight studio UI featuring Full-Bleed 2D Architectural Blueprint + Layout Builder, Living 3D Virtual Office (`React Three Fiber`, hybrid sculpted + rigged GLB avatars, NavGrid A* pathfinding, WASD first-person exploration, 0 KB Three.js on 2D boot), Clean Employee Drawer + Voice-to-Text (`ar-EG` / `en-US`), Task DAGs & Bounded Meetings, HR Hiring, Cron & Telegram Hub, Approvals Queue, Verified Memory Explorer, MCP Manager, Providers & Budgets, and Analytics & Git Backup Hub | [apps/web/src](apps/web/src) |

---

## Prerequisites

- **Node.js `24+`** (uses built-in `node:sqlite` with `FTS5` — zero native C++ SQLite compilation needed)
- **pnpm `12+`** (on Windows systems where `pnpm.ps1` is blocked by execution policy, run via `cmd /c pnpm ...`)
- **Git** (optional for `company/` Git Snapshot Backups and `--worktree` Tier 2 sandboxing)
- **Optional Runtimes / APIs**: `agy`, `codex`, `claude`, `ollama`, or API keys stored encrypted in **Vault** (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`). Works out of the box offline in `Mock` / `Dry-Run` modes.

---

## Quick Start

### 1. Development Mode (Backend `:4310` + Vite HMR `:5173`)
```powershell
cmd /c pnpm install
cmd /c pnpm dev
```
Open `http://127.0.0.1:5173`.

### 2. Standalone Production Mode (`http://127.0.0.1:4310`)
Builds `shared`, `server`, and `web` if needed and serves everything cleanly from Fastify:
```powershell
cmd /c pnpm start
```
Or double-click `scripts/start-office.cmd`.

### 3. Windows Desktop App Mode (Dedicated Frameless Window)
Launches the standalone server plus a dedicated `1440x900` Edge/Chrome app window with PWA manifest & custom architectural icon:
```powershell
cmd /c pnpm run desktop
```
Or double-click `scripts/start-desktop.cmd`. To place a shortcut on your Windows Desktop:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
```

> **Note on Native Tauri `.msi` Packaging (Optional):** Rust (`cargo` / `rustc`) and WebView2 are present, using the `x86_64-pc-windows-gnu` toolchain. Building a native Tauri v2 `.msi` installer requires switching to the `x86_64-pc-windows-msvc` target and installing Visual Studio C++ Build Tools. Until needed, `pnpm run desktop` provides a clean zero-build-tools desktop window experience.

---

## Security & Governance Invariants

1. **Localhost + Session Isolation:** Server enforces strict `127.0.0.1`/`localhost` `Host` and `Origin` checks, Bearer token auth on `/api/*` and `/ws`, and `sec-fetch-site: cross-site` blocking on `/__office_session`.
2. **Encrypted Vault (`DPAPI` / `AES-256-GCM`):** Secrets live in `data/vault.enc.json` (excluded from Git and portable JSON exports); REST APIs only return masked summaries and redact secrets from logs, WS frames, and exports.
3. **3-Tier Execution Policy:**
   - `tier1_auto`: Read-only analysis & research.
   - `tier2_guarded`: Isolated worktree / guarded writes.
   - `tier3_approval`: External writes, HR hiring, controlled skill/permission updates, and high-risk MCP tools (`google-workspace`, `notion`, `slack`, `github`) require explicit Founder approval (with idempotent execution and taint tracking for untrusted external inputs).
4. **Fail-Closed Telegram Bridge:** Empty `allowedChatIds` rejects all inbound updates and logs `telegram.unauthorized_chat` to SQLite audit logs.
5. **Live vs. Mock Budget Separation:** Mock & Dry-Run runs never pollute live daily/provider spend limits.

---

## Verification Commands

```powershell
cmd /c "pnpm typecheck && pnpm test && pnpm build"
```

- **19 Vitest suites / 51 automated tests** (`16` server suites / `44` tests + `3` web suites / `7` tests) covering security guards, Vault encryption, Arabic/English FTS5 search, 3-Tier Policy & Approvals, Direct APIs/Ollama fallback, internal/external MCP governance, Memory conflicts/learning/vectors, Task DAGs & Meetings, HR Hiring provisioning & rollback, Cron Scheduler, Telegram Bridge, Floorplan Layout Builder, Analytics CSV safety, standalone SPA traversal guards, Git Backup restore, 3D NavGrid A* pathfinding, avatar behavior state machine, and sample GLB validation.

---

## Roadmap & Next Phase Plans

Detailed engineering specifications and architecture docs live under [`docs/`](docs/plans/README.md):

- [Master Roadmap Index (`Phases 7–9`)](docs/plans/README.md)
- [Executive Obsidian Redesign Spec (`ASO AI HQ 2.0`)](docs/plans/redesign-executive-obsidian.md)
- [3D Studio Architecture (`R3F`)](docs/r3f-architecture.md)
- [Phase 7 — Adaptive Command Center UI/UX (`7A–7C`)](docs/plans/phase-7-ui-ux-command-center.md)
- [Phase 8 — Living 3D Virtual Office (`8A–8C`)](docs/plans/phase-8-living-3d-virtual-office.md)
- [Phase 9 — ASO AI HQ Pro Expansion (`9A–9E`)](docs/plans/phase-9-pro-expansion.md)

