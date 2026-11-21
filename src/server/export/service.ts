import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { ZipEntry } from "./zip.ts";

import { accountExports, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { logError } from "../platform/log.ts";
import { copy } from "../../shared/copy.ts";
import {
  EXPORT_CHUNK_BYTES,
  createExportWriter,
  newExportKey,
} from "../../shared/export-crypto.ts";
import { exportEntries } from "./archive.ts";
import { zipStream } from "./zip.ts";

export const EXPORT_BUILD_JOB_KIND = "export.build";
export const EXPORT_NOTIFY_JOB_KIND = "export.notify";
export const EXPORT_EXPIRE_JOB_KIND = "export.expire";

export const EXPORT_VALID_MS = 24 * 60 * 60_000;

export type AccountExportRow = typeof accountExports.$inferSelect;

export type AccountExportStatus = "none" | "preparing" | "ready" | "expired" | "failed";

export interface AccountExportView {
  id: string | null;
  status: AccountExportStatus;
  requestedAt: number | null;
  readyAt: number | null;
  expiresAt: number | null;
  downloadUrl: string | null;
}

export interface ExportServiceDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  mailDomain: string;
  appOrigin: string;
  mail: MailSender;
}

const payloadSchema = z.object({ exportId: z.string().min(1) });

function payloadOf(exportId: string) {
  return JSON.stringify({ exportId });
}

function objectKeyFor(userId: string, exportId: string) {
  return `files/${userId}/exports/${exportId}.ovex`;
}

function downloadPath(exportId: string) {
  return `/api/account/export/${exportId}/download`;
}

async function* sealArchive(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>, key: string) {
  const writer = await createExportWriter(key);

  yield writer.header;

  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  async function* flush() {
    if (pendingBytes < EXPORT_CHUNK_BYTES) {
      return;
    }

    const joined = new Uint8Array(pendingBytes);
    let at = 0;

    for (const part of pending) {
      joined.set(part, at);
      at += part.length;
    }

    const chunk = joined.subarray(0, EXPORT_CHUNK_BYTES);
    const rest = joined.subarray(EXPORT_CHUNK_BYTES);

    yield await writer.encrypt(new Uint8Array(chunk));

    pending = rest.length === 0 ? [] : [new Uint8Array(rest)];
    pendingBytes = rest.length;
  }

  for await (const part of zipStream(entries)) {
    if (part.length > EXPORT_CHUNK_BYTES) {
      throw new Error("The zip compressor produced a chunk too large to encrypt.");
    }

    pending.push(part);
    pendingBytes += part.length;

    yield* flush();
  }

  if (pendingBytes > 0) {
    const joined = new Uint8Array(pendingBytes);
    let at = 0;

    for (const part of pending) {
      joined.set(part, at);
      at += part.length;
    }

    yield await writer.encrypt(joined);
  }
}

/**
 * The user's current export, with the download link only while it is ready.
 * @param deps The export service's dependencies.
 * @param userId The signed-in user.
 * @returns The current state, with a download link only while it is ready.
 */
export async function readExportState(deps: ExportServiceDeps, userId: string) {
  const row = latestExportOf(deps.db, userId);

  if (row === undefined) {
    return {
      downloadUrl: null,
      expiresAt: null,
      id: null,
      readyAt: null,
      requestedAt: null,
      status: "none",
    };
  }

  if (
    row.status === "ready" &&
    row.expiresAt !== null &&
    deps.clock.now() >= row.expiresAt.getTime()
  ) {
    await expireExport(deps, row);

    const expired = deps.db
      .select()
      .from(accountExports)
      .where(eq(accountExports.id, row.id))
      .get();

    return stateOf(deps, expired ?? row);
  }

  return stateOf(deps, row);
}

function latestExportOf(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(accountExports)
    .where(eq(accountExports.userId, userId))
    .orderBy(desc(accountExports.requestedAt), desc(accountExports.id))
    .limit(1)
    .get();
}

async function stateOf(deps: ExportServiceDeps, row: AccountExportRow) {
  const key =
    row.status === "ready"
      ? await deps.personal.openFor(
          row.userId,
          { column: "key_enc", rowId: row.id, table: "account_exports" },
          row.keyEnc,
        )
      : null;

  return {
    downloadUrl: key === null ? null : `${downloadPath(row.id)}#${key}`,
    expiresAt: row.expiresAt?.getTime() ?? null,
    id: row.id,
    readyAt: row.readyAt?.getTime() ?? null,
    requestedAt: row.requestedAt.getTime(),
    status: row.status,
  };
}

async function expireExport(deps: ExportServiceDeps, row: AccountExportRow) {
  if (row.objectKey !== null) {
    await deps.objects.delete(row.objectKey);
  }

  deps.db
    .update(accountExports)
    .set({
      objectKey: null,
      status: "expired",
      updatedAt: new Date(deps.clock.now()),
    })
    .where(eq(accountExports.id, row.id))
    .run();
}

/**
 * Ask for a fresh export. One export exists at a time: a request while one is
 * being prepared returns that one, and a request while one is ready replaces
 * it, with a note.
 * @param deps The export service's dependencies.
 * @param userId The signed-in user.
 * @returns The export's state, and whether a ready one was replaced.
 */
export async function requestExport(deps: ExportServiceDeps, userId: string) {
  const latest = latestExportOf(deps.db, userId);

  if (latest?.status === "preparing") {
    return { replaced: false, state: await stateOf(deps, latest) };
  }

  if (
    latest?.status === "ready" &&
    deps.clock.now() < (latest.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY)
  ) {
    await expireExport(deps, latest);
  }

  const now = deps.clock.now();
  const requestedAt = new Date(Math.max(now, (latest?.requestedAt.getTime() ?? 0) + 1000));
  const id = crypto.randomUUID();
  const key = newExportKey();

  const keyEnc = await deps.personal.sealFor(
    userId,
    { column: "key_enc", rowId: id, table: "account_exports" },
    key,
  );

  const row: typeof accountExports.$inferInsert = {
    bytes: null,
    error: null,
    expiresAt: null,
    id,
    keyEnc,
    notifiedAt: null,
    objectKey: null,
    readyAt: null,
    requestedAt,
    status: "preparing",
    updatedAt: requestedAt,
    userId,
  };

  deps.db.insert(accountExports).values(row).run();

  enqueueJob(deps.db, deps.clock, EXPORT_BUILD_JOB_KIND, payloadOf(id), {
    dedupeKey: `${EXPORT_BUILD_JOB_KIND}:${id}`,
    maxAttempts: 1,
  });

  const stored = deps.db.select().from(accountExports).where(eq(accountExports.id, id)).get();

  if (stored === undefined) {
    throw new Error("The export request was not saved.");
  }

  return { replaced: latest?.status === "ready", state: await stateOf(deps, stored) };
}

/**
 * Build one export in the background and mark it ready for 24 hours.
 * @param deps The export service's dependencies.
 * @param exportId The export to build.
 * @returns Nothing; the row and the object hold the result.
 */
export async function runExportBuildJob(deps: ExportServiceDeps, exportId: string) {
  const row = deps.db.select().from(accountExports).where(eq(accountExports.id, exportId)).get();

  if (row === undefined) {
    return;
  }

  if (row.status !== "preparing") {
    return;
  }

  const key = await deps.personal.openFor(
    row.userId,
    { column: "key_enc", rowId: row.id, table: "account_exports" },
    row.keyEnc,
  );

  const objectKey = objectKeyFor(row.userId, row.id);

  try {
    const entries = exportEntries(
      {
        clock: deps.clock,
        db: deps.db,
        mailDomain: deps.mailDomain,
        objects: deps.objects,
        personal: deps.personal,
      },
      row.userId,
    );

    const bytes = await deps.objects.putStream(objectKey, sealArchive(entries, key));
    const now = deps.clock.now();

    deps.db
      .update(accountExports)
      .set({
        bytes,
        expiresAt: new Date(now + EXPORT_VALID_MS),
        objectKey,
        readyAt: new Date(now),
        status: "ready",
        updatedAt: new Date(now),
      })
      .where(eq(accountExports.id, exportId))
      .run();

    enqueueJob(deps.db, deps.clock, EXPORT_NOTIFY_JOB_KIND, payloadOf(exportId), {
      dedupeKey: `${EXPORT_NOTIFY_JOB_KIND}:${exportId}`,
      maxAttempts: 3,
    });

    enqueueJob(deps.db, deps.clock, EXPORT_EXPIRE_JOB_KIND, payloadOf(exportId), {
      dedupeKey: `${EXPORT_EXPIRE_JOB_KIND}:${exportId}`,
      maxAttempts: 2,
      runAt: now + EXPORT_VALID_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logError("export.build", error);

    deps.db
      .update(accountExports)
      .set({
        error: message,
        objectKey: null,
        status: "failed",
        updatedAt: new Date(deps.clock.now()),
      })
      .where(eq(accountExports.id, exportId))
      .run();

    await deps.objects.delete(objectKey);
  }
}

/**
 * Email the one user whose export is ready, with a link to the page that holds
 * the download. A second delivery of the same job sends nothing new.
 * @param deps The export service's dependencies.
 * @param exportId The export to announce.
 * @returns Nothing; a sent email is recorded on the row.
 */
export async function runExportNotifyJob(deps: ExportServiceDeps, exportId: string) {
  const row = deps.db.select().from(accountExports).where(eq(accountExports.id, exportId)).get();

  if (row === undefined) {
    return;
  }

  if (
    row.status !== "ready" ||
    row.notifiedAt !== null ||
    deps.clock.now() >= (row.expiresAt?.getTime() ?? 0)
  ) {
    return;
  }

  const user = deps.db.select().from(users).where(eq(users.id, row.userId)).get();

  if (user === undefined || !user.emailVerified) {
    return;
  }

  await deps.mail.sendExportReady({
    body: copy.mail.exportReadyBody(`${deps.appOrigin.replace(/\/+$/u, "")}/settings/export`),
    subject: copy.mail.exportReadySubject,
    to: user.email,
  });

  deps.db
    .update(accountExports)
    .set({ notifiedAt: new Date(deps.clock.now()), updatedAt: new Date(deps.clock.now()) })
    .where(eq(accountExports.id, exportId))
    .run();
}

/**
 * Delete a ready export's encrypted archive once its 24 hours are over.
 * @param deps The export service's dependencies.
 * @param exportId The export to expire.
 * @returns Nothing; the archive is deleted and the row marked expired.
 */
export async function runExportExpireJob(deps: ExportServiceDeps, exportId: string) {
  const row = deps.db.select().from(accountExports).where(eq(accountExports.id, exportId)).get();

  if (row === undefined) {
    return;
  }

  if (row.status !== "ready" || deps.clock.now() < (row.expiresAt?.getTime() ?? 0)) {
    return;
  }

  await expireExport(deps, row);
}

export interface ExportDownload {
  bytes: number;
  stream: ReadableStream<Uint8Array>;
}

/**
 * The encrypted bytes for one ready export, for its owner only.
 * @param deps The export service's dependencies.
 * @param userId The signed-in user.
 * @param exportId The export to download.
 * @returns The encrypted stream, or why it cannot be served.
 */
export async function readExportDownload(
  deps: ExportServiceDeps,
  userId: string,
  exportId: string,
) {
  const row = deps.db
    .select()
    .from(accountExports)
    .where(and(eq(accountExports.id, exportId), eq(accountExports.userId, userId)))
    .get();

  if (row === undefined) {
    return "not_found";
  }

  if (row.status === "expired") {
    return "expired";
  }

  if (row.objectKey === null) {
    return "not_found";
  }

  if (row.status !== "ready" || row.expiresAt === null) {
    return "not_found";
  }

  if (deps.clock.now() >= row.expiresAt.getTime()) {
    await expireExport(deps, row);

    return "expired";
  }

  const stream = await deps.objects.getStream(row.objectKey);

  if (stream === null) {
    return "not_found";
  }

  return { bytes: row.bytes ?? 0, stream };
}

/**
 * Every export row a user has, newest first. Used by the test routes to check
 * expiry and replacement without reading the encrypted archive.
 * @param db The application database.
 * @param userId The user to list for.
 * @returns The user's export rows, newest first.
 */
export function listExportsOf(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(accountExports)
    .where(eq(accountExports.userId, userId))
    .orderBy(desc(accountExports.requestedAt))
    .all();
}

export function parseExportPayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

export type ExportService = ReturnType<typeof createExportService>;

/**
 * Bind the export service to one process's dependencies.
 * @param deps The export service's dependencies.
 * @returns The service's six entry points.
 */
export function createExportService(deps: ExportServiceDeps) {
  return {
    build: async (exportId: string) => runExportBuildJob(deps, exportId),
    download: async (userId: string, exportId: string) =>
      readExportDownload(deps, userId, exportId),
    expire: async (exportId: string) => runExportExpireJob(deps, exportId),
    notify: async (exportId: string) => runExportNotifyJob(deps, exportId),
    request: async (userId: string) => requestExport(deps, userId),
    state: async (userId: string) => readExportState(deps, userId),
  };
}
