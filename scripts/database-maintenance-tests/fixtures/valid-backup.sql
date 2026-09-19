PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id", "name", "applied_at") VALUES (1, '0001_example.sql', '2026-09-04 00:00:00');
CREATE TABLE example (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL
);
CREATE INDEX example_value_idx ON example (value);
INSERT INTO example (id, value) VALUES (7, 'fixture');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('d1_migrations', 11);
INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('example', 12);
