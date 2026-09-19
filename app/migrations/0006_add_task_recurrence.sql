ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;

CREATE INDEX tasks_recurrence_rule_idx ON tasks (recurrence_rule);
