export async function verifyDatabase(database: D1Database): Promise<void> {
  await database.prepare("SELECT 1").first();
}
