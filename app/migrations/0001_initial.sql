CREATE TABLE areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE,
  trashed_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  work_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED')),
  area_id INTEGER REFERENCES areas(id),
  parent_task_id TEXT REFERENCES tasks(id),
  start TEXT,
  due TEXT,
  completed_at TEXT,
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
