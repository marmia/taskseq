CREATE TABLE owner_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  time_zone TEXT NOT NULL,
  week_starts_on INTEGER NOT NULL CHECK (week_starts_on BETWEEN 0 AND 6)
);

INSERT INTO owner_settings (id, time_zone, week_starts_on)
VALUES (1, 'Asia/Tokyo', 0);
