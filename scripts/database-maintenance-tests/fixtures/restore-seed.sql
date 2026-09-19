PRAGMA foreign_keys = ON;

INSERT INTO areas (id, name, color, position, trashed_at, is_system_managed)
VALUES (42, 'Restore Area', 'blue', 42, NULL, 0);
INSERT INTO areas (id, name, color, position, trashed_at, is_system_managed)
VALUES (43, 'Restore Trash Area', 'red', 43, '2026-09-08T01:02:03Z', 0);

INSERT INTO tags (id, name) VALUES (41, 'restore-tag');
INSERT INTO tags (id, name) VALUES (42, 'unicode-雪');

INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-parent', 'Restore ''quoted''; 雪', 'first line
second line; ''quoted''', 'work notes; 改行
continued', 'OPEN', 42, NULL,
  '2026-09-09', '2026-09-10T03:04:05Z', NULL, NULL,
  '2026-09-08T01:00:00Z', '2026-09-08T02:00:00Z', 7,
  NULL, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-child', 'Restore child', '', '', 'COMPLETED', 42,
  'restore-parent', NULL, NULL, '2026-09-08T03:00:00Z', NULL,
  '2026-09-08T01:10:00Z', '2026-09-08T03:00:00Z', 3,
  NULL, NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-recurring-source', 'Recurring source', 'repeat', '', 'COMPLETED',
  42, NULL, '2026-09-08', '2026-09-08', '2026-09-08T04:00:00Z', NULL,
  '2026-09-01T00:00:00Z', '2026-09-08T04:00:00Z', 2,
  NULL, 'mon', NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-recurring-next', 'Recurring source', 'repeat', '', 'OPEN',
  42, NULL, '2026-09-14', '2026-09-14', NULL, NULL,
  '2026-09-08T04:00:00Z', '2026-09-08T04:00:00Z', 1,
  NULL, 'mon', 'restore-recurring-source'
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-trashed', 'Trashed task', '', '', 'OPEN', 43, NULL,
  NULL, NULL, NULL, '2026-09-08T05:00:00Z',
  '2026-09-08T01:20:00Z', '2026-09-08T05:00:00Z', 4,
  'restore-trash-operation', NULL, NULL
);
INSERT INTO tasks (
  id, title, description, work_notes, status, area_id, parent_task_id,
  start, due, completed_at, trashed_at, created_at, updated_at, version,
  trash_operation_id, recurrence_rule, generated_from_task_id
)
VALUES (
  'restore-inbox', 'Inbox task', 'Inbox data', '', 'OPEN',
  (SELECT id FROM areas WHERE is_system_managed = 1), NULL,
  NULL, NULL, NULL, NULL,
  '2026-09-08T01:30:00Z', '2026-09-08T01:30:00Z', 1,
  NULL, NULL, NULL
);

INSERT INTO task_tags (task_id, tag_id) VALUES ('restore-parent', 41);
INSERT INTO task_tags (task_id, tag_id) VALUES ('restore-recurring-source', 42);
INSERT INTO task_manual_orders (group_key, task_id, position)
VALUES ('area:42:root', 'restore-parent', 0);
INSERT INTO task_manual_orders (group_key, task_id, position)
VALUES ('area:42:root', 'restore-recurring-source', 1);
INSERT INTO today_task_orders (owner_date, task_id, position)
VALUES ('2026-09-08', 'restore-parent', 0);
INSERT INTO today_task_orders (owner_date, task_id, position)
VALUES ('2026-09-08', 'restore-recurring-next', 1);

INSERT INTO views (
  id, name, all_tasks, conditions_json, sort_json, columns_json,
  version, created_at, updated_at
)
VALUES (
  'restore-view', 'Restore View', 0,
  '[{"field":"title","operator":"contains","value":"雪; quoted"}]',
  '[{"field":"updated","direction":"desc"}]',
  '["title","area","updated"]', 5,
  '2026-09-08T01:40:00Z', '2026-09-08T01:50:00Z'
);

UPDATE owner_settings
SET time_zone = 'Pacific/Auckland', week_starts_on = 1,
    trash_retention_days = 45, version = 9
WHERE id = 1;
