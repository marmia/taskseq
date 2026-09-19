INSERT INTO areas (name, color, position, is_system_managed, trashed_at)
VALUES
  ('Work', 'green', 1, 0, NULL),
  ('Archived Area', 'red', 2, 0, '2026-09-01T00:00:00.000Z');

INSERT INTO tags (name) VALUES ('old'), ('keep');

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-root', 'Root before', 'root description', 'root notes', 'OPEN', id,
  NULL, NULL, NULL, NULL, NULL, '2026-09-01T00:00:00.000Z',
  '2026-09-01T00:00:00.000Z', 3, NULL, NULL, NULL
FROM areas WHERE name = 'Work';

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-child', 'Child before', 'child description', 'child notes', 'OPEN', id,
  'update-root', NULL, NULL, NULL, NULL, '2026-09-01T00:00:01.000Z',
  '2026-09-01T00:00:01.000Z', 4, NULL, NULL, NULL
FROM areas WHERE name = 'Work';

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-completed-parent', 'Completed parent', '', '', 'COMPLETED', id,
  NULL, NULL, NULL, '2026-09-05T00:00:00.000Z', NULL,
  '2026-09-01T00:00:02.000Z', '2026-09-05T00:00:00.000Z', 5,
  NULL, NULL, NULL
FROM areas WHERE name = 'Work';

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-completed-child', 'Completed child', '', '', 'COMPLETED', id,
  'update-completed-parent', NULL, NULL, '2026-09-05T00:00:01.000Z', NULL,
  '2026-09-01T00:00:03.000Z', '2026-09-05T00:00:01.000Z', 6,
  NULL, NULL, NULL
FROM areas WHERE name = 'Work';

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-recurring', 'Recurring before', '', '', 'OPEN', id, NULL,
  '2026-09-07', '2026-09-07', NULL, NULL,
  '2026-09-01T00:00:04.000Z', '2026-09-01T00:00:04.000Z', 2,
  'mon', NULL, NULL
FROM areas WHERE name = 'Work';

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  recurrence_rule, generated_from_task_id, trash_operation_id
)
SELECT
  'update-trashed', 'Trashed Task', '', '', 'OPEN', id, NULL,
  NULL, NULL, NULL, '2026-09-06T00:00:00.000Z',
  '2026-09-01T00:00:05.000Z', '2026-09-06T00:00:00.000Z', 7,
  NULL, NULL, 'trash-operation'
FROM areas WHERE name = 'Work';

INSERT INTO task_tags (task_id, tag_id)
SELECT 'update-root', id FROM tags WHERE name = 'old';
INSERT INTO task_tags (task_id, tag_id)
SELECT 'update-child', id FROM tags WHERE name = 'keep';

INSERT INTO task_manual_orders (group_key, task_id, position) VALUES
  ('area:2', 'update-root', 0),
  ('parent:update-root', 'update-child', 0),
  ('area:2', 'update-completed-parent', 1),
  ('parent:update-completed-parent', 'update-completed-child', 0),
  ('area:2', 'update-recurring', 2);
