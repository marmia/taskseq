INSERT INTO areas (name, color, position, is_system_managed)
VALUES (
  'Export Area',
  'blue',
  (SELECT COALESCE(MAX(position), 0) + 1 FROM areas),
  0
);

INSERT INTO tags (name) VALUES ('alpha'), ('日本語');

INSERT INTO tasks (
  id,
  title,
  description,
  work_notes,
  status,
  area_id,
  parent_task_id,
  start,
  due,
  completed_at,
  trashed_at,
  created_at,
  updated_at,
  version,
  recurrence_rule,
  generated_from_task_id,
  trash_operation_id
)
SELECT
  'export-parent',
  '親Task',
  '引用符''と;セミコロン
Unicode 🧪',
  '',
  'OPEN',
  id,
  NULL,
  '2026-09-09',
  NULL,
  NULL,
  NULL,
  '2026-09-09T00:00:00.000Z',
  '2026-09-09T00:00:00.000Z',
  7,
  NULL,
  NULL,
  NULL
FROM areas
WHERE name = 'Export Area';

INSERT INTO tasks (
  id,
  title,
  description,
  work_notes,
  status,
  area_id,
  parent_task_id,
  start,
  due,
  completed_at,
  trashed_at,
  created_at,
  updated_at,
  version,
  recurrence_rule,
  generated_from_task_id,
  trash_operation_id
)
SELECT
  'export-child',
  'Completed child',
  '',
  'line 1
line 2',
  'COMPLETED',
  id,
  'export-parent',
  '2026-09-09T01:02:03+09:00',
  '2026-09-10T03:04:05Z',
  '2026-09-09T05:00:00.000Z',
  NULL,
  '2026-09-09T00:00:01.000Z',
  '2026-09-09T05:00:00.000Z',
  8,
  NULL,
  NULL,
  NULL
FROM areas
WHERE name = 'Export Area';

INSERT INTO tasks (
  id,
  title,
  status,
  area_id,
  start,
  due,
  created_at,
  updated_at,
  recurrence_rule
)
SELECT
  'export-recurring',
  'Recurring',
  'OPEN',
  id,
  '2026-09-09',
  '2026-09-09',
  '2026-09-09T00:00:02.000Z',
  '2026-09-09T00:00:02.000Z',
  'day'
FROM areas
WHERE name = 'Export Area';

INSERT INTO tasks (
  id,
  title,
  status,
  area_id,
  created_at,
  updated_at
)
SELECT
  'export-empty',
  'Empty fields',
  'OPEN',
  id,
  '2026-09-09T00:00:03.000Z',
  '2026-09-09T00:00:03.000Z'
FROM areas
WHERE is_system_managed = 1;

INSERT INTO tasks (
  id,
  title,
  status,
  area_id,
  trashed_at,
  created_at,
  updated_at,
  trash_operation_id
)
SELECT
  'export-trashed',
  'Must not export',
  'OPEN',
  id,
  '2026-09-09T06:00:00.000Z',
  '2026-09-09T00:00:04.000Z',
  '2026-09-09T06:00:00.000Z',
  'trash-operation'
FROM areas
WHERE name = 'Export Area';

INSERT INTO task_tags (task_id, tag_id)
SELECT 'export-child', id FROM tags WHERE name IN ('alpha', '日本語');

INSERT INTO task_tags (task_id, tag_id)
SELECT 'export-parent', id FROM tags WHERE name = 'alpha';
