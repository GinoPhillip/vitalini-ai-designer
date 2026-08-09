CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'suspended')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_generation_usage (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  generation_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE designs ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE designs ADD COLUMN render_preset TEXT;
ALTER TABLE designs ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS logos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS design_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  design_id TEXT NOT NULL,
  logo_id TEXT,
  message TEXT NOT NULL,
  placement_json TEXT,
  preview_object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'finalized', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (design_id) REFERENCES designs(id) ON DELETE CASCADE,
  FOREIGN KEY (logo_id) REFERENCES logos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_created ON invite_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON user_sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_designs_user_created_desc ON designs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logos_user_created ON logos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON design_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status_created ON design_requests (status, created_at DESC);
