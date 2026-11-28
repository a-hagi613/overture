import { eq } from "drizzle-orm";

import { normaliseEmail } from "../src/server/auth/email.ts";
import { inviteEmailHash } from "../src/server/auth/invites.ts";
import { authSecretConfig, env } from "../src/server/config/env.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { invites } from "../src/server/platform/db/schema.ts";

const email = normaliseEmail(process.argv[2] ?? "");

if (email === "") {
  throw new Error("usage: ops-invite.ts <email>");
}

const secret = authSecretConfig.accepted.at(0);

if (secret === undefined) {
  throw new Error("no accepted auth secret is configured");
}

const databasePath = env.DATABASE_PATH ?? "/data/app.sqlite";

const { db, sqlite } = openDatabase(databasePath);
const emailHash = inviteEmailHash(secret, email);
const existing = db.select().from(invites).where(eq(invites.emailHash, emailHash)).get();

if (existing === undefined) {
  db.insert(invites)
    .values({
      acceptedAt: null,
      acceptedUserId: null,
      createdAt: new Date(),
      emailEnc: null,
      emailHash,
      grantId: null,
      id: crypto.randomUUID(),
      invitedBy: null,
      revokedAt: null,
    })
    .run();

  process.stdout.write(`invite created for ${email}\n`);
} else {
  db.update(invites)
    .set({ acceptedAt: null, acceptedUserId: null, revokedAt: null })
    .where(eq(invites.id, existing.id))
    .run();

  process.stdout.write(`invite re-opened for ${email}\n`);
}

sqlite.close();
