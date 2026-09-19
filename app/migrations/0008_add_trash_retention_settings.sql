ALTER TABLE owner_settings
  ADD COLUMN trash_retention_days INTEGER NOT NULL DEFAULT 30
  CHECK (trash_retention_days > 0);

ALTER TABLE owner_settings
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0);
