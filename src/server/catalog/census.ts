import { and, count, countDistinct, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { SQL } from "drizzle-orm";
import { companies, companyBoards, postings, postingTags } from "../platform/db/schema.ts";

const TAG_DIMENSIONS = ["role", "subrole", "seniority"] as const;

const TOP_TITLES = 50;
const TOP_DEPARTMENTS = 50;
const TOP_COMPANIES = 20;

export interface CensusCountRow {
  key: string;
  open: number;
}

export interface CensusAtsRow {
  ats: string;
  open: number;
  closed: number;
}

export interface CensusBoardRow {
  ats: string;
  status: string;
  boards: number;
}

export interface CensusTagCoverageRow {
  dimension: string;
  classified: number;
  rulesClassified: number;
  unclassified: number;
  shareClassified: number;
  shareRulesClassified: number;
}

export interface CensusData {
  generatedAtIso: string;
  boardsTotal: number;
  companiesTotal: number;
  boardsByAtsStatus: CensusBoardRow[];
  postingsByAts: CensusAtsRow[];
  postingsByCountry: CensusCountRow[];
  postingsByWorkplace: CensusCountRow[];
  topTitles: CensusCountRow[];
  departments: CensusCountRow[];
  distinctDepartments: number;
  tagCoverage: CensusTagCoverageRow[];
  topCompanies: CensusCountRow[];
}

function countGroupedOpen<K extends string | null>(db: AppDatabase, key: SQL<K>) {
  return db
    .select({ key, open: count() })
    .from(postings)
    .where(isNull(postings.closedAt))
    .groupBy(key)
    .all()
    .map((row) => ({ key: row.key ?? "unknown", open: row.open }))
    .toSorted((left, right) => right.open - left.open || left.key.localeCompare(right.key));
}

function percent(share: number) {
  return `${share.toFixed(1)} %`;
}

export function buildCensus(db: AppDatabase, clock: Clock) {
  const totalBoardsRow = db.select({ total: count() }).from(companyBoards).get();
  const totalCompaniesRow = db.select({ total: count() }).from(companies).get();

  const boardsByAtsStatus = db
    .select({ ats: companyBoards.ats, status: companyBoards.status, boards: count() })
    .from(companyBoards)
    .groupBy(companyBoards.ats, companyBoards.status)
    .all()
    .map((row) => ({ ats: row.ats, status: row.status, boards: row.boards }))
    .toSorted(
      (left, right) => left.ats.localeCompare(right.ats) || left.status.localeCompare(right.status),
    );

  const openByAts = countGroupedOpen(db, sql<string>`${postings.ats}`).map((row) => ({
    ats: row.key,
    open: row.open,
  }));

  const closedByAts = db
    .select({ ats: postings.ats, closed: count() })
    .from(postings)
    .where(isNotNull(postings.closedAt))
    .groupBy(postings.ats)
    .all()
    .map((row) => ({ ats: row.ats, closed: row.closed }));

  const postingsByAts = openByAts.map((row) => ({
    ats: row.ats,
    open: row.open,
    closed: closedByAts.find((closed) => closed.ats === row.ats)?.closed ?? 0,
  }));

  const openPostings = openByAts.reduce((total, row) => total + row.open, 0);

  const tagCoverage = TAG_DIMENSIONS.map((dimension) => {
    const classifiedRow = db
      .select({ classified: countDistinct(postingTags.postingId) })
      .from(postingTags)
      .innerJoin(postings, eq(postings.id, postingTags.postingId))
      .where(and(eq(postingTags.dimension, dimension), isNull(postings.closedAt)))
      .get();

    const rulesClassifiedRow = db
      .select({ rulesClassified: countDistinct(postingTags.postingId) })
      .from(postingTags)
      .innerJoin(postings, eq(postings.id, postingTags.postingId))
      .where(
        and(
          eq(postingTags.dimension, dimension),
          eq(postingTags.source, "rules"),
          isNull(postings.closedAt),
        ),
      )
      .get();

    const classified = classifiedRow?.classified ?? 0;
    const rulesClassified = rulesClassifiedRow?.rulesClassified ?? 0;

    return {
      dimension,
      classified,
      rulesClassified,
      unclassified: openPostings - classified,
      shareClassified: openPostings === 0 ? 0 : (classified / openPostings) * 100,
      shareRulesClassified: openPostings === 0 ? 0 : (rulesClassified / openPostings) * 100,
    } satisfies CensusTagCoverageRow;
  });

  const departments = countGroupedOpen(db, sql<string | null>`${postings.department}`);
  const hasNoDepartment = departments.some((row) => row.key === "unknown");
  const distinctDepartments = hasNoDepartment ? departments.length - 1 : departments.length;

  return {
    generatedAtIso: new Date(clock.now()).toISOString(),
    boardsTotal: totalBoardsRow?.total ?? 0,
    companiesTotal: totalCompaniesRow?.total ?? 0,
    boardsByAtsStatus,
    postingsByAts,
    postingsByCountry: countGroupedOpen(db, sql<string | null>`${postings.countryCode}`),
    postingsByWorkplace: countGroupedOpen(db, sql<string>`${postings.workplace}`),
    topTitles: countGroupedOpen(db, sql<string>`${postings.titleNorm}`).slice(0, TOP_TITLES),
    departments: departments.slice(0, TOP_DEPARTMENTS),
    distinctDepartments,
    tagCoverage,
    topCompanies: db
      .select({ company: companies.name, open: count() })
      .from(postings)
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(isNull(postings.closedAt))
      .groupBy(companies.id, companies.name)
      .orderBy(sql`count(*) desc, companies.name asc`)
      .limit(TOP_COMPANIES)
      .all()
      .map((row) => ({ key: row.company, open: row.open })),
  } satisfies CensusData;
}

function countTable(rows: { key: string; open: number }[]) {
  return rows.map((row) => `| ${row.key} | ${String(row.open)} |`).join("\n");
}

export function renderCensusMarkdown(census: CensusData) {
  const boardsRows = census.boardsByAtsStatus
    .map((row) => `| ${row.ats} | ${row.status} | ${String(row.boards)} |`)
    .join("\n");

  const postingsRows = census.postingsByAts
    .map((row) => `| ${row.ats} | ${String(row.open)} | ${String(row.closed)} |`)
    .join("\n");

  const coverageRows = census.tagCoverage
    .map(
      (row) =>
        `| ${row.dimension} | ${String(row.classified)} | ${String(row.rulesClassified)} | ${String(row.unclassified)} | ${percent(row.shareClassified)} | ${percent(row.shareRulesClassified)} |`,
    )
    .join("\n");

  return `# Catalog census

Aggregate counts of the discovery catalog and nothing else: no person names, no emails, no apply
URLs, no Postings descriptions. Company names appear only as aggregate counts. Board status
\`empty\` means the live feed read succeeded but lists no Postings; \`active\` means it read with
Postings; \`gone\` means the feed returned not found on two polls.

Generated: ${census.generatedAtIso}

Boards: ${String(census.boardsTotal)} across ${String(census.companiesTotal)} companies.

## Boards by ATS and status

| ATS | status | boards |
| --- | --- | --- |
${boardsRows}

## Postings by ATS

| ATS | open | closed |
| --- | --- | --- |
${postingsRows}

## Postings by country

| Country | open |
| --- | --- |
${countTable(census.postingsByCountry)}

## Postings by workplace

| Workplace | open |
| --- | --- |
${countTable(census.postingsByWorkplace)}

## Top titles (top ${String(TOP_TITLES)}, normalized, open Postings)

| Title | open |
| --- | --- |
${countTable(census.topTitles)}

## Department frequency (top ${String(TOP_DEPARTMENTS)} of ${String(census.distinctDepartments)} departments with open Postings)

| Department | open |
| --- | --- |
${countTable(census.departments)}

## Rule coverage by tag dimension

| Dimension | classified | by rules | unclassified | classified share | rules share |
| --- | --- | --- | --- | --- | --- |
${coverageRows}

## Top companies by open Postings (top ${String(TOP_COMPANIES)})

| Company | open |
| --- | --- |
${countTable(census.topCompanies)}
`;
}
