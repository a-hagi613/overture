import { Database } from "bun:sqlite";
import { chmodSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";

import { createClock } from "../src/server/platform/ports/clock.ts";
import {
  V1_EXPORT_FORMAT,
  V1_EXPORT_VERSION,
  v1ExportSchema,
} from "../src/server/profile/v1-export.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    out: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;
const outPath = args.values.out;

if (databasePath === undefined || outPath === undefined) {
  throw new Error("usage: bun run scripts/export-v1-facts.ts --db <v1.db> --out <export.json>");
}

const sqlite = new Database(databasePath, { readonly: true });

function hasTable(name: string) {
  return (
    sqlite
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null
  );
}

for (const required of ["answer_entries", "answer_years", "learned_answers"]) {
  if (!hasTable(required)) {
    throw new Error(`${databasePath} has no ${required} table: it is not a v1 database`);
  }
}

const entryRows = sqlite
  .query<
    {
      key: string;
      group: string;
      question: string;
      valueJson: string;
      kind: string;
      updatedAt: string;
      ownerEdited: number;
    },
    []
  >(
    `SELECT key, grp AS "group", question, value AS "valueJson", kind,
            updated_at AS "updatedAt", owner_edited AS "ownerEdited"
       FROM answer_entries ORDER BY sort_order, key`,
  )
  .all();

const yearRows = sqlite
  .query<{ key: string; skill: string; years: number; position: number }, []>(
    "SELECT key, skill, years, position FROM answer_years ORDER BY position",
  )
  .all();

const achievementRows = hasTable("answer_achievements")
  ? sqlite
      .query<{ position: number; text: string }, []>(
        "SELECT position, text FROM answer_achievements ORDER BY position",
      )
      .all()
  : [];

const aliasRows = hasTable("answer_aliases")
  ? sqlite
      .query<{ labelNorm: string; label: string; key: string; createdAt: string }, []>(
        `SELECT label_norm AS "labelNorm", label, key, created_at AS "createdAt"
           FROM answer_aliases ORDER BY label_norm`,
      )
      .all()
  : [];

const settingRows = hasTable("answer_meta")
  ? sqlite
      .query<{ name: string; value: number }, []>(
        "SELECT name, value FROM answer_meta ORDER BY name",
      )
      .all()
  : [];

const learnedRows = sqlite
  .query<
    {
      normalizedLabel: string;
      widgetType: string;
      value: string;
      basis: string;
      confidence: number;
      source: string;
      timesUsed: number;
      timesCorrected: number;
      createdAt: string;
      updatedAt: string;
    },
    []
  >(
    `SELECT normalized_label AS "normalizedLabel", widget_type AS "widgetType", value, basis,
            confidence, source, times_used AS "timesUsed", times_corrected AS "timesCorrected",
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM learned_answers ORDER BY normalized_label, widget_type`,
  )
  .all();

const exported = v1ExportSchema.parse({
  format: V1_EXPORT_FORMAT,
  version: V1_EXPORT_VERSION,
  exportedAt: createClock().now(),
  answerBank: {
    entries: entryRows.map((row) => ({
      key: row.key,
      group: row.group,
      question: row.question,
      value: z.json().parse(JSON.parse(row.valueJson)),
      kind: row.kind,
      updatedAt: row.updatedAt,
      ownerEdited: row.ownerEdited === 1,
    })),
    years: yearRows.map((row) => ({
      key: row.key,
      skill: row.skill,
      years: row.years,
      position: row.position,
    })),
    achievements: achievementRows.map((row) => ({ position: row.position, text: row.text })),
    aliases: aliasRows.map((row) => ({
      labelNorm: row.labelNorm,
      label: row.label,
      key: row.key,
      createdAt: row.createdAt,
    })),
    settings: settingRows.map((row) => ({ name: row.name, value: row.value })),
  },
  learnedAnswers: learnedRows.map((row) => ({
    normalizedLabel: row.normalizedLabel,
    widgetType: row.widgetType,
    value: row.value,
    basis: row.basis,
    confidence: row.confidence,
    source: row.source,
    timesUsed: row.timesUsed,
    timesCorrected: row.timesCorrected,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })),
});

writeFileSync(outPath, `${JSON.stringify(exported, null, 2)}\n`, { mode: 0o600 });

chmodSync(outPath, 0o600);

process.stdout.write(
  `${JSON.stringify(
    {
      out: outPath,
      answerBankEntries: exported.answerBank.entries.length,
      answerYears: exported.answerBank.years.length,
      achievements: exported.answerBank.achievements.length,
      aliases: exported.answerBank.aliases.length,
      settings: exported.answerBank.settings.length,
      learnedAnswers: exported.learnedAnswers.length,
    },
    null,
    2,
  )}\n`,
);
