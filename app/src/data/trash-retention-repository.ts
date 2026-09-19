import { subDays } from "date-fns";

type OwnerSettingsRow = {
  trash_retention_days: number;
};

export async function deleteExpiredTrash(
  database: D1Database,
  scheduledAt: Date,
) {
  const ownerSettings = await database
    .prepare("SELECT trash_retention_days FROM owner_settings WHERE id = 1")
    .first<OwnerSettingsRow>();
  if (!ownerSettings) {
    throw new Error("Owner settings are not initialized");
  }

  const expiresBefore = subDays(
    scheduledAt,
    ownerSettings.trash_retention_days,
  ).toISOString();
  await database.batch([
    database
      .prepare(
        "DELETE FROM tasks WHERE trashed_at IS NOT NULL AND trashed_at < ?",
      )
      .bind(expiresBefore),
    database
      .prepare(
        "DELETE FROM areas WHERE trashed_at IS NOT NULL AND trashed_at < ?",
      )
      .bind(expiresBefore),
  ]);
}
