CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  risk_tier TEXT NOT NULL DEFAULT 'tier1_auto',
  enabled INTEGER NOT NULL DEFAULT 1,
  max_runs_per_day INTEGER NOT NULL DEFAULT 6,
  runs_today_count INTEGER NOT NULL DEFAULT 0,
  last_run_day TEXT,
  last_run_id TEXT,
  last_run_status TEXT,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled
  ON scheduled_jobs (enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  run_id TEXT,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job
  ON scheduled_job_runs (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_run
  ON scheduled_job_runs (run_id);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  text TEXT NOT NULL,
  linked_run_id TEXT,
  linked_approval_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_created
  ON telegram_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_run
  ON telegram_messages (linked_run_id);
