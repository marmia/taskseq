ALTER TABLE tasks ADD COLUMN trash_operation_id TEXT;

CREATE INDEX tasks_trash_operation_id_idx
  ON tasks (trash_operation_id);
