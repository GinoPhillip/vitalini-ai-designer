CREATE TABLE IF NOT EXISTS design_edits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  design_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  design_id TEXT REFERENCES designs(id) ON DELETE CASCADE,
  edit_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, design_key)
);

CREATE TABLE IF NOT EXISTS client_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  design_id TEXT REFERENCES designs(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
