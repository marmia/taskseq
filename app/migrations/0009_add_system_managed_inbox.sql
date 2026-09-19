ALTER TABLE areas
  ADD COLUMN is_system_managed INTEGER NOT NULL DEFAULT 0
  CHECK (is_system_managed IN (0, 1));

INSERT INTO areas (name, color, position, is_system_managed)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM areas WHERE name = 'Inbox') THEN 'Inbox (system)'
    ELSE 'Inbox'
  END,
  'gray',
  COALESCE((SELECT MIN(position) - 1 FROM areas), 0),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM areas WHERE is_system_managed = 1
);

UPDATE tasks
SET area_id = (
  SELECT id FROM areas WHERE is_system_managed = 1
)
WHERE area_id IS NULL;
