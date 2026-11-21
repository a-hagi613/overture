import { databasePath, env } from "../src/server/config/env.ts";
import { seedDemoAccount } from "../src/server/demo/seed.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { parseMasterKey } from "../src/server/platform/crypto.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { createDiskObjectStore } from "../src/server/platform/ports/object-store.ts";
import { createR2ObjectStore } from "../src/server/platform/ports/r2-object-store.ts";
import { createPersonalCrypto } from "../src/server/profile/personal-crypto.ts";
import { demoLoginEmail } from "../src/shared/demo.ts";

const { db, sqlite } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const personal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

const objects =
  env.R2_ACCOUNT_ID !== undefined &&
  env.R2_ACCESS_KEY_ID !== undefined &&
  env.R2_SECRET_ACCESS_KEY !== undefined &&
  env.R2_BUCKET_FILES !== undefined
    ? createR2ObjectStore({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        bucket: env.R2_BUCKET_FILES,
        endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      })
    : createDiskObjectStore(env.OBJECT_STORE_ROOT);

const { userId } = await seedDemoAccount({
  clock: createClock(),
  db,
  objects,
  personal,
});

sqlite.close();

process.stdout.write(`demo account ready: ${demoLoginEmail} (${userId})\n`);
