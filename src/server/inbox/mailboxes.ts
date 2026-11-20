import { eq } from "drizzle-orm";

import { forwardingIdFrom, forwardingLocalPart } from "../../shared/inbound-mail.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { mailboxes } from "../platform/db/schema.ts";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 16;

function randomMailboxId() {
  let id = "";

  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2))) {
      if (byte < 252) {
        id += ID_ALPHABET[byte % ID_ALPHABET.length];

        if (id.length === ID_LENGTH) {
          return id;
        }
      }
    }
  }

  return id;
}

export function createMailboxService(
  db: AppDatabase,
  clock: Clock,
  secret: string,
  domain: string,
) {
  function addressOf(localPart: string) {
    return `${localPart}@${domain}`;
  }

  async function ensureFor(userId: string) {
    const existing = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

    if (existing !== undefined) {
      return { id: existing.id, address: addressOf(existing.localPart) };
    }

    const id = randomMailboxId();
    const localPart = await forwardingLocalPart(secret, id);

    try {
      db.insert(mailboxes)
        .values({
          id,
          userId,
          localPart,
          status: "active",
          createdAt: new Date(clock.now()),
        })
        .run();

      return { id, address: addressOf(localPart) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes("UNIQUE")) {
        throw error;
      }

      const raced = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

      if (raced === undefined) {
        throw error;
      }

      return { id: raced.id, address: addressOf(raced.localPart) };
    }
  }

  async function byForwardingAddress(address: string) {
    const id = await forwardingIdFrom(secret, address);

    if (id === null) {
      return null;
    }

    const mailbox = db.select().from(mailboxes).where(eq(mailboxes.id, id)).get();

    if (mailbox === undefined) {
      return null;
    }

    return { ...mailbox, address: addressOf(mailbox.localPart) };
  }

  function byId(id: string) {
    const mailbox = db.select().from(mailboxes).where(eq(mailboxes.id, id)).get();

    return mailbox ?? null;
  }

  return { ensureFor, byForwardingAddress, byId };
}
