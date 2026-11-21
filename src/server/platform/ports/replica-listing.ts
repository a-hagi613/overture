/**
 * Reads the newest transaction on a Litestream replica one compaction level at a time.
 *
 * `litestream ltx -level all` asks object storage for all ten levels, which is ten
 * ListObjectsV2 calls per read and was the largest R2 Class A line (#281). Litestream writes every
 * new transaction to level 0 and only moves or deletes older files upward, so the first level that
 * holds any file holds the newest one.
 */
export interface ReplicaTransaction {
  max_txid: string;
  timestamp: string;
}

/** Lists one compaction level; plain values are allowed so tests need no async wrapper. */
export type ReplicaLevelReader = (
  level: number,
) => ReplicaTransaction[] | null | Promise<ReplicaTransaction[] | null>;

const REPLICA_LEVELS = Array.from({ length: 10 }, (_, level) => level);

/**
 * Orders transactions by `max_txid`, the replicas' own ordering.
 *
 * @param left The first transaction.
 * @param right The second transaction.
 * @returns A negative number, zero or a positive number, as a sort comparator expects.
 */
export function compareTransactions(left: ReplicaTransaction, right: ReplicaTransaction) {
  if (left.max_txid < right.max_txid) {
    return -1;
  }

  return left.max_txid > right.max_txid ? 1 : 0;
}

function newestTransaction(transactions: ReplicaTransaction[]) {
  const ordered = transactions.toSorted(compareTransactions);

  return ordered.at(-1);
}

/**
 * Returns the newest transaction, or null when no level could be read, or undefined when every
 * level is empty. A level that cannot be read is skipped so a partially unreadable replica still
 * reports lag instead of disappearing from health.
 *
 * Level 0 holds the newest file while the database is writing, so a healthy replica costs one list
 * per read. Only when level 0 is empty (before the first write, or a read error) are the other
 * levels read, together, in order.
 *
 * @param readLevel Lists one compaction level; null when that level cannot be read.
 * @returns The newest transaction, or null or undefined as described above.
 */
export async function readNewestReplicaTransaction(readLevel: ReplicaLevelReader) {
  const levelZero = await readLevel(0);
  const levelZeroNewest = levelZero === null ? undefined : newestTransaction(levelZero);

  if (levelZeroNewest !== undefined) {
    return levelZeroNewest;
  }

  const upperLevels = await Promise.all(
    REPLICA_LEVELS.slice(1).map(async (level) => ({ listing: await readLevel(level) })),
  );

  let unreadable = levelZero === null;

  for (const { listing } of upperLevels) {
    if (listing === null) {
      unreadable = true;
      continue;
    }

    const newest = newestTransaction(listing);

    if (newest !== undefined) {
      return newest;
    }
  }

  return unreadable ? null : undefined;
}
