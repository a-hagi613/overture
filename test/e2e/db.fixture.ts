import { openDatabase } from "../../src/server/platform/db/client.ts";
import { verifications } from "../../src/server/platform/db/schema.ts";

export function readVerifications(databasePath: string) {
  const { db, sqlite } = openDatabase(databasePath);

  try {
    return db.select().from(verifications).all();
  } finally {
    sqlite.close();
  }
}
