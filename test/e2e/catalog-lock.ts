import { Database } from "bun:sqlite";

const catalogPath = process.argv.at(2);

if (catalogPath === undefined) {
  throw new Error("usage: bun run test/e2e/catalog-lock.ts <catalog.sqlite>");
}

const database = new Database(catalogPath);

database.run("PRAGMA busy_timeout = 5000;");

database.run("BEGIN IMMEDIATE");

database.run("update postings set missing_polls = missing_polls + 1");

process.stdout.write("locked\n");

await Bun.stdin.text();

database.run("ROLLBACK");

database.close();
