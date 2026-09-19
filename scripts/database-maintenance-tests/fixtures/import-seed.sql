INSERT INTO areas (name, color, position, is_system_managed)
VALUES ('Work', 'green', 1, 0);

INSERT INTO tags (name) VALUES ('existing');

INSERT INTO tasks (
  id,
  title,
  status,
  area_id,
  created_at,
  updated_at,
  version
)
SELECT
  'import-existing-parent',
  'Existing parent',
  'OPEN',
  id,
  '2026-09-01T00:00:00.000Z',
  '2026-09-01T00:00:00.000Z',
  3
FROM areas
WHERE name = 'Work';
