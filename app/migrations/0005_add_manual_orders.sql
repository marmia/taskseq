CREATE TABLE task_manual_orders (
  group_key TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (group_key, task_id),
  UNIQUE (group_key, position)
);

CREATE INDEX task_manual_orders_task_id_idx
  ON task_manual_orders (task_id);

CREATE TABLE today_task_orders (
  owner_date TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner_date, task_id),
  UNIQUE (owner_date, position)
);

CREATE INDEX today_task_orders_task_id_idx
  ON today_task_orders (task_id);
