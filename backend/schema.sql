CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('popbill')),
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  disconnected_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('app', 'widget')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_connection_id_idx
  ON sessions(connection_id);

CREATE INDEX IF NOT EXISTS connections_expires_at_idx
  ON connections(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  actor_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_attempts_actor_idx
  ON rate_limit_attempts(actor_hash, attempted_at);

CREATE TABLE IF NOT EXISTS scheduler_leases (
  name TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL
);
