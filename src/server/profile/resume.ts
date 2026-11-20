import { extractText, getDocumentProxy } from "unpdf";
import { Buffer } from "node:buffer";
import { and, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";

import { resumes } from "../platform/db/schema.ts";
import { checkLlmCaps } from "../platform/llm/caps.ts";
import { recordLlmUsage } from "../platform/llm/usage.ts";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const RESUME_PDF_PURPOSE = "resume_pdf";
const MIN_UNPDF_TEXT_CHARS = 200;

const RESUME_PDF_PROMPT =
  "Extract the full text of this resume PDF in reading order. Return only the text.";

export interface ParsedResume {
  text: string;
  parsedWith: "unpdf" | "llm";
  pages: number;
}

export interface ResumeRecord {
  id: string;
  filename: string;
  sha256: string;
  bytes: number;
  pages: number;
  parsedWith: "unpdf" | "llm";
  unreadable: boolean;
  isCurrent: boolean;
  uploadedAt: Date;
}

export interface ResumeUpload {
  resume: ResumeRecord;
  text: string;
}

export interface ResumeService {
  upload: (
    userId: string,
    file: { name: string; bytes: Uint8Array<ArrayBuffer> },
  ) => Promise<ResumeUpload>;
  current: (userId: string) => Promise<ResumeRecord | null>;
  currentFileBytes: (
    userId: string,
  ) => Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string } | null>;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

const resumeScope = (resumeId: string, column: string) => ({
  table: "resumes",
  column,
  rowId: resumeId,
});

export function createResumeService(deps: {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  personal: PersonalCrypto;
  llm: LlmPort;
}) {
  const { db, clock, objects, personal, llm } = deps;

  async function currentRow(userId: string) {
    const rows = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);

    return rows.at(0);
  }

  async function toRecord(userId: string, row: typeof resumes.$inferSelect) {
    const filename = await personal.openFor(
      userId,
      resumeScope(row.id, "filename_enc"),
      row.filenameEnc,
    );

    const text = await personal.openFor(userId, resumeScope(row.id, "text_enc"), row.textEnc);

    return {
      id: row.id,
      filename,
      sha256: row.sha256,
      bytes: row.bytes,
      pages: row.pages,
      parsedWith: row.parsedWith,
      unreadable: text.trim().length === 0,
      isCurrent: row.isCurrent,
      uploadedAt: row.uploadedAt,
    };
  }

  async function extractResumeText(userId: string, pdf: Uint8Array<ArrayBuffer>) {
    const document = await getDocumentProxy(new Uint8Array(pdf));

    const extracted = await extractText(document, { mergePages: true });

    if (extracted.text.trim().length >= MIN_UNPDF_TEXT_CHARS) {
      return {
        text: extracted.text,
        parsedWith: "unpdf" as const,
        pages: extracted.totalPages,
      } satisfies ParsedResume;
    }

    const request = { user: RESUME_PDF_PROMPT, pdf };

    const caps = checkLlmCaps(db, clock, {
      userId,
      purpose: RESUME_PDF_PURPOSE,
      estimatedCostMicros: llm.estimateSingleCostMicros(request),
    });

    if (!caps.withinCaps) {
      return {
        text: "",
        parsedWith: "unpdf" as const,
        pages: extracted.totalPages,
      } satisfies ParsedResume;
    }

    const call = await llm.runSingle(request);

    recordLlmUsage(db, clock, {
      userId,
      purpose: RESUME_PDF_PURPOSE,
      model: call.model,
      inputTokens: call.inputTokens,
      cachedTokens: call.cachedTokens,
      outputTokens: call.outputTokens,
      costMicros: call.costMicros,
    });

    const text = (call.text ?? "").trim();

    if (text.length === 0) {
      return {
        text: "",
        parsedWith: "unpdf" as const,
        pages: extracted.totalPages,
      } satisfies ParsedResume;
    }

    return { text, parsedWith: "llm" as const, pages: extracted.totalPages } satisfies ParsedResume;
  }

  return {
    upload: async (userId: string, file: { name: string; bytes: Uint8Array<ArrayBuffer> }) => {
      const id = crypto.randomUUID();

      const bytes = new Uint8Array(file.bytes);
      const byteCount = bytes.byteLength;

      const digest = await sha256(bytes);

      const objectKey = `files/${userId}/resume/${id}.pdf.enc`;

      const sealedFile = await personal.sealFor(
        userId,
        resumeScope(id, "bytes"),
        Buffer.from(bytes).toString("base64"),
      );

      const parsed = await extractResumeText(userId, bytes);

      const filenameEnc = await personal.sealFor(
        userId,
        resumeScope(id, "filename_enc"),
        file.name,
      );

      const textEnc = await personal.sealFor(userId, resumeScope(id, "text_enc"), parsed.text);

      await objects.put(objectKey, encodeUtf8(sealedFile));

      const uploadedAt = new Date(clock.now());

      const values = {
        id,
        userId,
        objectKey,
        sha256: digest,
        bytes: byteCount,
        pages: parsed.pages,
        filenameEnc,
        textEnc,
        parsedWith: parsed.parsedWith,
        isCurrent: true,
        uploadedAt,
      } satisfies typeof resumes.$inferInsert;

      await db.transaction(async (tx) => {
        await tx
          .update(resumes)
          .set({ isCurrent: false })
          .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)));

        await tx.insert(resumes).values(values);
      });

      const rows = await db.select().from(resumes).where(eq(resumes.id, id)).limit(1);

      const row = rows.at(0);

      if (row === undefined) {
        throw new Error("resume insert failed");
      }

      return { resume: await toRecord(userId, row), text: parsed.text };
    },
    current: async (userId: string) => {
      const row = await currentRow(userId);

      return row === undefined ? null : toRecord(userId, row);
    },
    currentFileBytes: async (userId: string) => {
      const row = await currentRow(userId);

      if (row === undefined) {
        return null;
      }

      const stored = await objects.get(row.objectKey);

      if (stored === null) {
        return null;
      }

      const base64 = await personal.openFor(
        userId,
        resumeScope(row.id, "bytes"),
        decodeUtf8(stored),
      );

      const filename = await personal.openFor(
        userId,
        resumeScope(row.id, "filename_enc"),
        row.filenameEnc,
      );

      return { bytes: bytesFromBase64(base64), filename };
    },
  } satisfies ResumeService;
}

function encodeUtf8(value: string) {
  const bytes = new Uint8Array(new TextEncoder().encode(value));

  return bytes;
}

function decodeUtf8(bytes: Uint8Array<ArrayBuffer>) {
  return new TextDecoder().decode(bytes);
}

function bytesFromBase64(base64: string) {
  const buffer = Buffer.from(base64, "base64");

  const bytes = new Uint8Array(buffer.byteLength);

  bytes.set(buffer);

  return bytes;
}
