CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT,
  external_session_id TEXT,
  runtime_provider TEXT,
  rolling_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_employee
  ON conversations (employee_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_provider TEXT NOT NULL,
  model TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  prompt TEXT NOT NULL,
  config_snapshot_json TEXT NOT NULL,
  final_output TEXT,
  error_code TEXT,
  error_message TEXT,
  worktree_branch TEXT,
  worktree_path TEXT,
  diff_stat TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_conversation
  ON runs (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  run_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
  ON run_events (run_id, run_seq ASC);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  assigned_employee_id TEXT,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks (project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  task_id TEXT,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  action_type TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  precondition_json TEXT,
  diff_preview TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  tainted_by_external_input INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  decision_note TEXT,
  execution_result_json TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (status, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_day
  ON usage_ledger (mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_employee
  ON usage_ledger (employee_id, mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_project
  ON usage_ledger (project_id, mode, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS indexed_files (
  file_path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT,
  employee_id TEXT,
  memory_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  verified_by TEXT NOT NULL,
  decay_score REAL NOT NULL DEFAULT 1.0,
  supersedes_id TEXT,
  tainted_by_external_input INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_scope
  ON memory_entries (scope, project_id, employee_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  entry_id UNINDEXED,
  scope UNINDEXED,
  project_id UNINDEXED,
  employee_id UNINDEXED,
  title,
  normalized_content
);
