import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { openDatabase } from "../../src/server/platform/db/client.ts";
import { WRITE_BATCH_ROWS } from "../../src/server/platform/db/batches.ts";
import { companies, companyBoards, postings } from "../../src/server/platform/db/schema.ts";

export const FEED_POSTINGS_PER_BOARD = 12_500;
export const CLOSED_POSTINGS = 30;
export const GREENHOUSE_POSTINGS = 20;
export const EXPECTED_POSTINGS_RESET = FEED_POSTINGS_PER_BOARD * 2;

const SEEDED_AT = 1_760_000_000_000;

const countSchema = z.object({ n: z.number() });

type PostingInsert = typeof postings.$inferInsert;

interface Segment {
  ats: "ashby" | "greenhouse" | "lever";
  boardId: string;
  count: number;
  closed: boolean;
}

function postingRow(segment: Segment, index: number) {
  const state = segment.closed ? "closed" : "open";
  const label = `${segment.ats}-${state}-${String(index)}`;

  return {
    id: `retag-posting-${label}`,
    boardId: segment.boardId,
    companyId: "retag-company",
    ats: segment.ats,
    atsJobId: label,
    url: `https://retag.example/${label}`,
    applyUrlNorm: `https://retag.example/${label}`,
    title: `Posting ${label}`,
    titleNorm: `posting ${label}`,
    firstSeenAt: SEEDED_AT,
    lastSeenAt: SEEDED_AT,
    dedupeKey: `retag-dedupe-${label}`,
    closedAt: segment.closed ? SEEDED_AT : null,
    feedContentHash: `retag-hash-${label}`,
  } satisfies PostingInsert;
}

export function seedRetagCatalog(databasePath: string) {
  const { db, sqlite } = openDatabase(databasePath);
  const companyId = "retag-company";
  const ashbyBoardId = "retag-board-ashby";
  const leverBoardId = "retag-board-lever";
  const greenhouseBoardId = "retag-board-greenhouse";

  const segments: Segment[] = [
    { ats: "ashby", boardId: ashbyBoardId, count: FEED_POSTINGS_PER_BOARD, closed: false },
    { ats: "lever", boardId: leverBoardId, count: FEED_POSTINGS_PER_BOARD, closed: false },
    { ats: "ashby", boardId: ashbyBoardId, count: CLOSED_POSTINGS, closed: true },
    { ats: "greenhouse", boardId: greenhouseBoardId, count: GREENHOUSE_POSTINGS, closed: false },
  ];

  db.transaction((tx) => {
    tx.insert(companies)
      .values({
        id: companyId,
        name: "Retag Fixture",
        nameNorm: "retag fixture",
        createdAt: SEEDED_AT,
      })
      .run();

    tx.insert(companyBoards)
      .values([
        {
          id: ashbyBoardId,
          companyId,
          ats: "ashby",
          boardToken: "retag-ashby",
          source: "discovered",
          contentHash: "retag-board-hash-ashby",
          createdAt: SEEDED_AT,
        },
        {
          id: leverBoardId,
          companyId,
          ats: "lever",
          boardToken: "retag-lever",
          source: "discovered",
          contentHash: "retag-board-hash-lever",
          createdAt: SEEDED_AT,
        },
        {
          id: greenhouseBoardId,
          companyId,
          ats: "greenhouse",
          boardToken: "retag-greenhouse",
          source: "discovered",
          contentHash: "retag-board-hash-greenhouse",
          createdAt: SEEDED_AT,
        },
      ])
      .run();

    for (const segment of segments) {
      for (let start = 0; start < segment.count; start += WRITE_BATCH_ROWS) {
        const end = Math.min(start + WRITE_BATCH_ROWS, segment.count);
        const rows: PostingInsert[] = [];

        for (let index = start; index < end; index += 1) {
          rows.push(postingRow(segment, index));
        }

        tx.insert(postings).values(rows).run();
      }
    }
  });

  sqlite.close();
}

function count(database: DatabaseSync, query: string) {
  return countSchema.parse(database.prepare(query).get()).n;
}

export function readRetagState(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    return {
      openFeedPostingsWithHash: count(
        database,
        "select count(*) as n from postings where board_id in ('retag-board-ashby','retag-board-lever') and closed_at is null and feed_content_hash is not null",
      ),
      closedFeedPostingsWithHash: count(
        database,
        "select count(*) as n from postings where board_id in ('retag-board-ashby','retag-board-lever') and closed_at is not null and feed_content_hash is not null",
      ),
      greenhousePostingsWithHash: count(
        database,
        "select count(*) as n from postings where board_id = 'retag-board-greenhouse' and feed_content_hash is not null",
      ),
      feedBoardsWithHash: count(
        database,
        "select count(*) as n from company_boards where id in ('retag-board-ashby','retag-board-lever') and content_hash is not null",
      ),
      greenhouseBoardsWithHash: count(
        database,
        "select count(*) as n from company_boards where id = 'retag-board-greenhouse' and content_hash is not null",
      ),
    };
  } finally {
    database.close();
  }
}
