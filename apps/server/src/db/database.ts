import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lightweight wrapper over Node 24's built-in `node:sqlite` DatabaseSync
 * providing WAL mode, idempotent SQL migrations, transactions, and clean WAL checkpointing.
 */
export class OfficeDatabase {
  public readonly db: DatabaseSync;
  private readonly isMemory: boolean;
  private closed = false;

  constructor(dbPath: string) {
    this.isMemory = dbPath === ":memory:";
    if (!this.isMemory) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (!this.isMemory) {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");
    }
    this.runMigrations();
  }

  private resolveMigrationsDir(): string {
    const local = path.join(__dirname, "migrations");
    if (fs.existsSync(local)) {
      return local;
    }
    // Fallback when running from compiled dist/ if migrations weren't copied beside JS
    const srcFallback = path.resolve(__dirname, "../../src/db/migrations");
    if (fs.existsSync(srcFallback)) {
      return srcFallback;
    }
    throw new Error(`Migrations directory not found near ${__dirname}`);
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = this.db
      .prepare("SELECT version FROM schema_migrations")
      .all() as Array<{ version: number }>;
    const applied = new Set(appliedRows.map((row) => Number(row.version)));

    const migrationsDir = this.resolveMigrationsDir();
    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const fileName of files) {
      const match = /^(\d+)_/.exec(fileName);
      if (!match) {
        continue;
      }
      const version = Number(match[1]);
      if (applied.has(version)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
      this.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(version, new Date().toISOString());
      });
    }
  }

  /**
   * Executes a synchronous callback inside an IMMEDIATE SQLite transaction.
   */
  public transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Ignore rollback errors if connection already rolled back
      }
      throw error;
    }
  }

  public checkpoint(): void {
    if (this.closed || this.isMemory) {
      return;
    }
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    try {
      this.checkpoint();
    } finally {
      this.db.close();
      this.closed = true;
    }
  }
}
