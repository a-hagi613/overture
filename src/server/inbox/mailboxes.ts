import { and, eq, isNull, sql } from "drizzle-orm";

import {
  aliasHandleBase,
  aliasHandleCandidate,
  applyAliasAddress,
} from "../../shared/apply-alias.ts";
import { forwardingIdFrom, forwardingLocalPart } from "../../shared/inbound-mail.ts";
import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { mailboxes, retiredAddresses, users } from "../platform/db/schema.ts";
import { clearBlockerIfRecovered } from "../profile/running-state.ts";
import { publishEvent } from "../platform/sse/stream.ts";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 16;
const ID_ATTEMPTS = 5;
const ALIAS_ATTEMPTS = 8;
const ALIAS_SUFFIX_LENGTH = 3;

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

function randomAliasSuffix() {
  let suffix = "";

  while (suffix.length < ALIAS_SUFFIX_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ALIAS_SUFFIX_LENGTH * 2))) {
      if (byte < 252) {
        suffix += ID_ALPHABET[byte % ID_ALPHABET.length];

        if (suffix.length === ALIAS_SUFFIX_LENGTH) {
          return suffix;
        }
      }
    }
  }

  return suffix;
}

function aliasTaken(writer: DatabaseWriter, handle: string) {
  const live = writer
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(
      sql`lower(substr(${mailboxes.applyAddress}, 1, instr(${mailboxes.applyAddress}, '@') - 1)) = ${handle}`,
    )
    .get();

  if (live !== undefined) {
    return true;
  }

  return (
    writer
      .select({ localPart: retiredAddresses.localPart })
      .from(retiredAddresses)
      .where(eq(retiredAddresses.localPart, handle))
      .get() !== undefined
  );
}

export function createMailboxService(
  db: AppDatabase,
  clock: Clock,
  secret: string,
  domain: string,
  aliasDomain: string = domain,
) {
  const host = domain.trim().toLowerCase();
  const aliasHost = aliasDomain.trim().toLowerCase();

  function addressOf(localPart: string) {
    return `${localPart}@${host}`;
  }

  function describe(row: {
    id: string;
    localPart: string;
    applyAddress: string | null;
    firstForwardedAt: Date | null;
  }) {
    return {
      id: row.id,
      address: addressOf(row.localPart),
      applyAddress: row.applyAddress,
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

  function freshAlias(writer: DatabaseWriter, userId: string) {
    const person = writer
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const base = aliasHandleBase(person?.name ?? "", person?.email ?? "");

    for (let attempt = 0; attempt < ALIAS_ATTEMPTS; attempt += 1) {
      const handle = aliasHandleCandidate(base, attempt, randomAliasSuffix());

      if (!aliasTaken(writer, handle)) {
        return applyAliasAddress(handle, aliasHost);
      }
    }

    throw new Error("Could not allocate an apply alias that was never assigned or retired.");
  }

  async function assignAlias(mailboxId: string, userId: string) {
    const assigned = await retryWhenBusy(
      () =>
        db.transaction(
          (tx) => {
            const current = tx
              .select({ applyAddress: mailboxes.applyAddress })
              .from(mailboxes)
              .where(eq(mailboxes.id, mailboxId))
              .get();

            if (current === undefined || current.applyAddress !== null) {
              return null;
            }

            const applyAddress = freshAlias(tx, userId);

            tx.update(mailboxes).set({ applyAddress }).where(eq(mailboxes.id, mailboxId)).run();

            return applyAddress;
          },
          { behavior: "immediate" },
        ),
      "mailbox.assign-alias",
    );

    if (assigned !== null) {
      publishEvent(db, clock, "mailbox.updated", JSON.stringify({ mailboxId }), userId);
    }

    return assigned;
  }

  async function createFor(userId: string, id: string, localPart: string) {
    return await retryWhenBusy(
      () =>
        db.transaction(
          (tx) => {
            const raced = tx.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

            if (raced !== undefined) {
              return { applyAddress: null, mailbox: raced };
            }

            const applyAddress = freshAlias(tx, userId);

            tx.insert(mailboxes)
              .values({
                id,
                userId,
                localPart,
                applyAddress,
                status: "active",
                createdAt: new Date(clock.now()),
              })
              .run();

            return { applyAddress, mailbox: undefined };
          },
          { behavior: "immediate" },
        ),
      "mailbox.create",
    );
  }

  async function ensureFor(userId: string) {
    const existing = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

    if (existing !== undefined) {
      const applyAddress = existing.applyAddress ?? (await assignAlias(existing.id, userId));

      if (existing.status === "active") {
        clearBlockerIfRecovered(db, clock, userId, "no_mailbox");
      }

      return describe({ ...existing, applyAddress });
    }

    const { id, localPart } = await freshAddress();
    const created = await createFor(userId, id, localPart);

    if (created.mailbox !== undefined) {
      return describe(created.mailbox);
    }

    clearBlockerIfRecovered(db, clock, userId, "no_mailbox");
    publishEvent(db, clock, "mailbox.updated", JSON.stringify({ mailboxId: id }), userId);

    return {
      id,
      address: addressOf(localPart),
      applyAddress: created.applyAddress,
      firstForwardedAt: null,
    };
  }

  function readFor(userId: string) {
    const existing = db.select().from(mailboxes).where(eq(mailboxes.userId, userId)).get();

    return existing === undefined ? null : describe(existing);
  }

  async function byForwardingAddress(address: string) {
    const normalized = address.trim().toLowerCase();

    const byAlias = db.select().from(mailboxes).where(eq(mailboxes.applyAddress, normalized)).get();

    if (byAlias !== undefined) {
      return { ...byAlias, address: addressOf(byAlias.localPart) };
    }

    const [localPart = "", addressHost = ""] = normalized.split("@");

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

    const unaliased = db
      .select({ id: mailboxes.id, userId: mailboxes.userId })
      .from(mailboxes)
      .where(isNull(mailboxes.applyAddress))
      .all();

    await Promise.all(
      unaliased.map(async (mailbox) => await assignAlias(mailbox.id, mailbox.userId)),
    );

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
