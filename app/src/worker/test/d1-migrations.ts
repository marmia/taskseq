import initialMigration from "../../../migrations/0001_initial.sql?raw";
import trashOperationMigration from "../../../migrations/0002_add_task_trash_operation.sql?raw";
import ownerSettingsMigration from "../../../migrations/0003_add_owner_settings.sql?raw";
import tagsMigration from "../../../migrations/0004_add_tags.sql?raw";
import manualOrdersMigration from "../../../migrations/0005_add_manual_orders.sql?raw";
import recurrenceMigration from "../../../migrations/0006_add_task_recurrence.sql?raw";
import recurringTaskGenerationMigration from "../../../migrations/0007_track_recurring_task_generation.sql?raw";
import trashRetentionSettingsMigration from "../../../migrations/0008_add_trash_retention_settings.sql?raw";
import systemManagedInboxMigration from "../../../migrations/0009_add_system_managed_inbox.sql?raw";
import savedSearchesMigration from "../../../migrations/0010_add_saved_searches.sql?raw";
import viewsMigration from "../../../migrations/0011_add_views_remove_saved_searches.sql?raw";
import displayLanguageMigration from "../../../migrations/0012_add_display_language.sql?raw";

export const d1Migrations = [
  { name: "0001_initial.sql", queries: sqlStatements(initialMigration) },
  {
    name: "0002_add_task_trash_operation.sql",
    queries: sqlStatements(trashOperationMigration),
  },
  {
    name: "0003_add_owner_settings.sql",
    queries: sqlStatements(ownerSettingsMigration),
  },
  { name: "0004_add_tags.sql", queries: sqlStatements(tagsMigration) },
  {
    name: "0005_add_manual_orders.sql",
    queries: sqlStatements(manualOrdersMigration),
  },
  {
    name: "0006_add_task_recurrence.sql",
    queries: sqlStatements(recurrenceMigration),
  },
  {
    name: "0007_track_recurring_task_generation.sql",
    queries: sqlStatements(recurringTaskGenerationMigration),
  },
  {
    name: "0008_add_trash_retention_settings.sql",
    queries: sqlStatements(trashRetentionSettingsMigration),
  },
  {
    name: "0009_add_system_managed_inbox.sql",
    queries: sqlStatements(systemManagedInboxMigration),
  },
  {
    name: "0010_add_saved_searches.sql",
    queries: sqlStatements(savedSearchesMigration),
  },
  {
    name: "0011_add_views_remove_saved_searches.sql",
    queries: sqlStatements(viewsMigration),
  },
  {
    name: "0012_add_display_language.sql",
    queries: sqlStatements(displayLanguageMigration),
  },
];

function sqlStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
