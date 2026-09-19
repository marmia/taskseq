DROP TABLE saved_searches;

CREATE TABLE views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  all_tasks INTEGER NOT NULL CHECK (all_tasks IN (0, 1)),
  conditions_json TEXT NOT NULL,
  sort_json TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
