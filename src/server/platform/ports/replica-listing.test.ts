import { expect, test } from "bun:test";

import type { ReplicaTransaction } from "./replica-listing.ts";
import { readNewestReplicaTransaction } from "./replica-listing.ts";

function transaction(maxTxid: string) {
  return {
    max_txid: maxTxid,
    timestamp: "2026-11-21T12:00:00.000Z",
  } satisfies ReplicaTransaction;
}

test("the newest replica transaction comes from level 0 without listing the other levels", async () => {
  const levelsRead: number[] = [];

  const newest = await readNewestReplicaTransaction((level) => {
    levelsRead.push(level);

    return level === 0 ? [transaction("0000000000000002"), transaction("0000000000000009")] : [];
  });

  expect(newest).toEqual(transaction("0000000000000009"));
  expect(levelsRead).toEqual([0]);
});

test("when level 0 is empty the other levels are read once each and the first non-empty one wins", async () => {
  const levelsRead: number[] = [];

  const filesByLevel = new Map<number, ReplicaTransaction[]>([
    [2, [transaction("0000000000000004")]],
    [5, [transaction("0000000000000001")]],
  ]);

  const newest = await readNewestReplicaTransaction((level) => {
    levelsRead.push(level);

    return filesByLevel.get(level) ?? [];
  });

  expect(newest).toEqual(transaction("0000000000000004"));
  expect(levelsRead.toSorted((left, right) => left - right)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
});

test("a level that cannot be read is skipped so the rest of the replica still reports lag", async () => {
  const newest = await readNewestReplicaTransaction((level) => {
    if (level === 0) {
      return null;
    }

    return level === 1 ? [transaction("0000000000000004")] : [];
  });

  expect(newest).toEqual(transaction("0000000000000004"));
});

test("null means no level could be read, undefined means every level is empty", async () => {
  const unreadable = await readNewestReplicaTransaction(() => null);

  expect(unreadable).toBeNull();

  const empty = await readNewestReplicaTransaction(() => []);

  expect(empty).toBeUndefined();
});
