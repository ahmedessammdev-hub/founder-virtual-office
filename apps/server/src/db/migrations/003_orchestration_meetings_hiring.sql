CREATE TABLE IF NOT EXISTS task_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  orchestrator_employee_id TEXT NOT NULL,
  project_id TEXT,
  root_task_id TEXT,
  mode TEXT NOT NULL,
  max_concurrency INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL,
  synthesis_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_plans_status
  ON task_plans (status, created_at DESC);

CREATE TABLE IF NOT EXISTS task_plan_nodes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_employee_id TEXT NOT NULL,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  risk_tier TEXT NOT NULL DEFAULT 'tier1_auto',
  provider_override TEXT,
  model_override TEXT,
  status TEXT NOT NULL,
  output_summary TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES task_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_plan_nodes_plan
  ON task_plan_nodes (plan_id);
CREATE INDEX IF NOT EXISTS idx_task_plan_nodes_run
  ON task_plan_nodes (run_id);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  agenda TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  facilitator_employee_id TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  max_rounds INTEGER NOT NULL DEFAULT 2,
  mode TEXT NOT NULL,
  auto_create_tasks INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  decisions_json TEXT NOT NULL DEFAULT '[]',
  action_items_json TEXT NOT NULL DEFAULT '[]',
  minutes_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_meetings_status
  ON meetings (status, created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_turns (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  run_id TEXT,
  summary TEXT NOT NULL,
  key_points_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_turns_meeting
  ON meeting_turns (meeting_id, round ASC, turn_index ASC);

CREATE TABLE IF NOT EXISTS hiring_proposals (
  id TEXT PRIMARY KEY,
  proposed_by_employee_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  proposed_desk_json TEXT NOT NULL,
  diff_preview TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provisioned_at TEXT,
  rolled_back_at TEXT,
  rollback_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_hiring_proposals_status
  ON hiring_proposals (status, created_at DESC);
