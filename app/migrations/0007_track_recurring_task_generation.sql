ALTER TABLE tasks ADD COLUMN generated_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX tasks_active_generated_from_task_id_idx
  ON tasks (generated_from_task_id)
  WHERE generated_from_task_id IS NOT NULL AND trashed_at IS NULL;
