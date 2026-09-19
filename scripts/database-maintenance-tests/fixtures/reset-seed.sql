PRAGMA foreign_keys = ON;

INSERT INTO areas (name, color, position, trashed_at)
VALUES ('reset-test-area', 'blue', 9999, NULL);
INSERT INTO areas (name, color, position, trashed_at)
VALUES ('reset-test-trash-area', 'red', 10000, '2026-09-06T00:00:00Z');

INSERT INTO tags (name) VALUES ('reset-test-tag');
INSERT INTO tags (name) VALUES ('reset-test-tag-2');

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id
)
VALUES (
  'reset-test-open', 'Reset test open', 'description', 'notes', 'OPEN',
  (SELECT id FROM areas WHERE name = 'reset-test-area'), NULL,
  NULL, NULL, NULL, NULL, '2026-09-06T00:00:00Z',
  '2026-09-06T00:00:00Z', 2, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id
)
VALUES (
  'reset-test-child', 'Reset test child', '', '','OPEN',
  (SELECT id FROM areas WHERE name = 'reset-test-area'), 'reset-test-open',
  NULL, NULL, NULL, NULL, '2026-09-06T00:00:00Z',
  '2026-09-06T00:00:00Z', 1, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id
)
VALUES (
  'reset-test-completed', 'Reset test completed', '', '', 'COMPLETED',
  (SELECT id FROM areas WHERE name = 'reset-test-area'), NULL,
  NULL, NULL, '2026-09-06T00:00:00Z', NULL, '2026-09-06T00:00:00Z',
  '2026-09-06T00:00:00Z', 1, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id
)
VALUES (
  'reset-test-trash', 'Reset test trash', '', '', 'OPEN',
  (SELECT id FROM areas WHERE name = 'reset-test-trash-area'), NULL,
  NULL, NULL, NULL, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z',
  '2026-09-06T00:00:00Z', 1, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id
)
VALUES (
  'reset-test-inbox', 'Reset test inbox', '', '', 'OPEN',
  (SELECT id FROM areas WHERE is_system_managed = 1), NULL,
  NULL, NULL, NULL, NULL, '2026-09-06T00:00:00Z',
  '2026-09-06T00:00:00Z', 1, NULL, NULL
);

INSERT INTO task_tags (task_id, tag_id)
SELECT 'reset-test-open', id FROM tags WHERE name = 'reset-test-tag';
INSERT INTO task_tags (task_id, tag_id)
SELECT 'reset-test-completed', id FROM tags WHERE name = 'reset-test-tag-2';
INSERT INTO task_manual_orders (group_key, task_id, position)
VALUES ('reset-test-group', 'reset-test-open', 0);
INSERT INTO task_manual_orders (group_key, task_id, position)
VALUES ('reset-test-group', 'reset-test-child', 1);
INSERT INTO today_task_orders (owner_date, task_id, position)
VALUES ('2099-01-01', 'reset-test-completed', 0);
INSERT INTO views (
  id, name, all_tasks, conditions_json, sort_json, columns_json,
  version, created_at, updated_at
)
VALUES (
  'reset-test-view', 'Reset test view', 1, '[]', '[]', '[]', 3,
  '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z'
);

UPDATE owner_settings
SET time_zone = 'UTC', week_starts_on = 1, trash_retention_days = 7, version = 88
WHERE id = 1;
