ALTER TABLE memory_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memory_entries ADD COLUMN conflict_with_id TEXT;
ALTER TABLE memory_entries ADD COLUMN conflict_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_entries_status
  ON memory_entries (status, scope, project_id, employee_id);

CREATE TABLE IF NOT EXISTS memory_vectors (
  entry_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_vectors_model
  ON memory_vectors (model);

CREATE TABLE IF NOT EXISTS learning_proposals (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  project_id TEXT,
  run_id TEXT,
  conversation_id TEXT,
  feedback_rating TEXT NOT NULL,
  feedback_text TEXT NOT NULL,
  expected_behavior TEXT,
  reflection TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_file_path TEXT NOT NULL,
  scope TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  before_content TEXT NOT NULL,
  after_content TEXT NOT NULL,
  diff_preview TEXT NOT NULL,
  evaluation_json TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_id TEXT,
  snapshot_before_sha256 TEXT,
  snapshot_after_sha256 TEXT,
  rolled_back_at TEXT,
  rollback_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_proposals_status
  ON learning_proposals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_proposals_employee
  ON learning_proposals (employee_id, created_at DESC);
