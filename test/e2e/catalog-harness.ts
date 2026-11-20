import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { startAppServer } from "./app-server.ts";
import { startGreenhouseFixtureServer } from "./greenhouse-fixture-server.ts";

import type { AppServer } from "./app-server.ts";
import type { FixtureServer } from "./greenhouse-fixture-server.ts";

const TEMPLATE_DB = join(process.cwd(), "test/e2e/.tmp/template.db");

const postingRowSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  atsJobId: z.string(),
  title: z.string(),
  titleNorm: z.string(),
  department: z.string().nullable(),
  locationRaw: z.string().nullable(),
  closedAt: z.number().nullable(),
  missingPolls: z.number(),
  dedupeKey: z.string(),
  lastSeenAt: z.number(),
});

const boardRowSchema = z.object({
  id: z.string(),
  boardToken: z.string(),
  status: z.string(),
  etag: z.string().nullable(),
  contentHash: z.string().nullable(),
  lastPolledAt: z.number().nullable(),
  nextPollAt: z.number().nullable(),
  notFoundPolls: z.number(),
  consecutiveErrors: z.number(),
});

const companyIdSchema = z.object({ id: z.string() });

const companyCreatedResponseSchema = z.object({ id: z.string() });

const boardCreatedResponseSchema = z.object({ id: z.string() });

const runDueResponseSchema = z.object({ ran: z.number() });

export interface PostingRow extends z.infer<typeof postingRowSchema> {}

export interface BoardRow extends z.infer<typeof boardRowSchema> {}

export interface CatalogHarness {
  app: AppServer;
  fixture: FixtureServer;
  companyId: string;
  boardIds: Record<string, string>;
  close: () => Promise<void>;
}

export async function startCatalogHarness(boardTokens: string[]): Promise<CatalogHarness> {
  const fixture = await startGreenhouseFixtureServer();
  const directory = mkdtempSync(join(tmpdir(), "overture-catalog-"));
  const databasePath = join(directory, "overture.db");

  const app = await startAppServer(databasePath, {
    GREENHOUSE_FEED_BASE_URL: fixture.url,
  });

  const companyResponse = await postJson(`${app.url}/__test__/catalog/companies`, {
    name: "Fixture Dynamics",
    domain: "fixture.example",
  });

  const { id: companyId } = companyCreatedResponseSchema.parse(await companyResponse.json());
  const boardIds: Record<string, string> = {};

  for (const token of boardTokens) {
    const boardResponse = await postJson(`${app.url}/__test__/catalog/boards`, {
      companyId,
      ats: "greenhouse",
      boardToken: token,
    });

    boardIds[token] = boardCreatedResponseSchema.parse(await boardResponse.json()).id;
  }

  return {
    app,
    fixture,
    companyId,
    boardIds,
    close: async () => {
      await app.stop();
      fixture.stop();
    },
  };
}

export async function postBackfillAndRun(harness: CatalogHarness): Promise<void> {
  await postJson(`${harness.app.url}/__test__/jobs/enqueue`, {
    kind: "catalog.backfill",
    payload: "{}",
  });
  await postJson(`${harness.app.url}/__test__/jobs/run-due`, {});
}

export async function catalogPostings(appUrl: string): Promise<PostingRow[]> {
  const response = await fetch(`${appUrl}/__test__/catalog/postings`);

  return z.array(postingRowSchema).parse((await response.json()).postings);
}

export async function catalogBoards(appUrl: string): Promise<BoardRow[]> {
  const response = await fetch(`${appUrl}/__test__/catalog/boards`);

  return z.array(boardRowSchema).parse((await response.json()).boards);
}

async function postJson(url: string, body: unknown): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return expectOk(response, `POST ${url}`);
}

async function expectOk(response: Response, label: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${label} failed: ${String(response.status)}`);
  }

  return response;
}
