import { and, eq, isNull } from "drizzle-orm";

import { forwardingIdFrom, forwardingLocalPart } from "../../shared/inbound-mail.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { mailboxes, retiredAddresses, users } from "../platform/db/schema.ts";
import { clearBlockerIfRecovered } from "../profile/running-state.ts";
import { publishEvent } from "../platform/sse/stream.ts";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 16;
const ID_ATTEMPTS = 5;

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
  const host = domain.trim().toLowerCase();

  function addressOf(localPart: string) {
    return `${localPart}@${host}`;
  }

  function describe(row: { id: string; localPart: string; firstForwardedAt: Date | null }) {
    return {
      id: row.id,
      address: addressOf(row.localPart),
      firstForwardedAt: row.firstForwardedAt?.getTime() ?? null,
    };
  }

  async function freshAddress() {
    if (secret === "") {
      throw new Error("A forwarding address needs INBOUND_HMAC_SECRET.");
    }

    const candidates = await Promise.all(
      Array.from({ length: ID_ATTEMPTS }, async () => {
        const id = randomMailboxId();

        return { id, localPart: await forwardingLocalPart(secret, id) };
      }),
    );

    const free = candidates.find(
      (candidate) =>
        db
          .select({ localPart: retiredAddresses.localPart })
          .from(retiredAddresses)
          .where(eq(retiredAddresses.localPart, candidate.localPart))
          .get() === undefined,
    );

    if (free === undefined) {
      throw new Error("Could not allocate a forwarding address that was never retired.");
    }

    return free;
  }

  async function ensureFor(userId: string) {
    const existing = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

    if (existing !== undefined) {
      if (existing.status === "active") {
        clearBlockerIfRecovered(db, clock, userId, "no_mailbox");
      }

      return describe(existing);
    }

    const { id, localPart } = await freshAddress();

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

      clearBlockerIfRecovered(db, clock, userId, "no_mailbox");
      publishEvent(db, clock, "mailbox.updated", JSON.stringify({ mailboxId: id }), userId);

      return { id, address: addressOf(localPart), firstForwardedAt: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes("UNIQUE")) {
        throw error;
      }

      const raced = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

      if (raced === undefined) {
        throw error;
      }

      return describe(raced);
    }
  }

  function readFor(userId: string) {
    const existing = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

    return existing === undefined ? null : describe(existing);
  }

  async function byForwardingAddress(address: string) {
    const [localPart = "", addressHost = ""] = address.trim().toLowerCase().split("@");

    if (addressHost !== host) {
      return null;
    }

    const id = await forwardingIdFrom(secret, localPart);

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

  function markFirstForwarded(mailboxId: string, at: number) {
    const before = db
      .select({ firstForwardedAt: mailboxes.firstForwardedAt, userId: mailboxes.userId })
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .get();

    if (before === undefined || before.firstForwardedAt !== null) {
      return;
    }

    db.update(mailboxes)
      .set({ firstForwardedAt: new Date(at) })
      .where(and(eq(mailboxes.id, mailboxId), isNull(mailboxes.firstForwardedAt)))
      .run();

    publishEvent(
      db,
      clock,
      "mailbox.updated",
      JSON.stringify({ firstForwardedAt: at, mailboxId }),
      before.userId,
    );
  }

  function retireFor(userId: string) {
    const existing = db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .get();

    if (existing === undefined) {
      return false;
    }

    db.delete(mailboxes).where(eq(mailboxes.userId, userId)).run();
    publishEvent(db, clock, "mailbox.updated", JSON.stringify({ retired: true }), userId);

    return true;
  }

  async function ensureForAll() {
    const missing = db
      .select({ id: users.id })
      .from(users)
      .leftJoin(mailboxes, eq(mailboxes.userId, users.id))
      .where(isNull(mailboxes.id))
      .all();

    await Promise.all(missing.map(async (user) => ensureFor(user.id)));

    const total = db.select({ id: mailboxes.id }).from(mailboxes).all().length;

    return { created: missing.length, existing: total - missing.length, total };
  }

  return {
    ensureFor,
    ensureForAll,
    byForwardingAddress,
    byId,
    markFirstForwarded,
    readFor,
    retireFor,
  };
}
