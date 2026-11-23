CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'done')),
  created_at TEXT NOT NULL
);
CREATE INDEX todos_owner_created ON todos (owner_id, created_at DESC);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX conversations_owner_updated ON conversations (owner_id, updated_at DESC);

CREATE TABLE chat_requests (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
