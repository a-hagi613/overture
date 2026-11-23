---
status: accepted
---

# Master-key rotation re-wraps data keys and keeps a version chain

Amends ADR 0014 (`docs/adr/0014-envelope-encryption.md`). Implements issue #541.

The master key is the one secret that protects every user's data key. Before this decision it could never be
retired: `MASTER_KEY_CURRENT` had to be 1, `openValue` only knew the single key it was handed, and a raised
version stopped production at boot. The Wave 4 audit found this the highest-risk residual.

## Decision

1. **A version chain at boot.** `MASTER_KEY_CURRENT=N` needs a contiguous chain of `MASTER_KEY_V<k>` from the
   lowest configured version to `N`; a missing version in that range stops boot with a message naming it.
   Versions above `CURRENT` may be pre-staged so the new secret can be deployed before the version is raised.
2. **Stored rows decide the lower bound.** `user_keys` rows still wrapped under a version below the chain stop
   boot with a message naming the missing key and the row count, so removing an old secret too early fails
   closed instead of serving `null` for every encrypted value.
3. **Re-wrapping, never re-sealing.** The rotation unwraps each `user_keys.wrapped_dek` with the old key and
   re-wraps the same data key under the new one, recording `master_key_version` per row. The DEK is unchanged,
   so every value already sealed with it — which records the version it was sealed under, `v1:{key_version}:…` —
   stays readable; the `key_version` segment is historical and is checked for format only, never compared with
   the row or a configured key.
4. **Dual read during the window.** `openValue`, `sealValue` and the deleted-account notice try the row's
   version, then `MASTER_KEY_CURRENT`, then every older key still configured. A row, cached key or notice from
   either side of the move opens throughout the rotation.
5. **Bounded, resumable batches.** Each batch re-wraps at most 250 rows outside the write lock and commits all of
   them in one `{ behavior: "immediate" }` transaction with `retryWhenBusy`, updating a row only while it still
   carries the version read. A crash loses at most one batch; the next run selects the rows still below the
   current version, so no row is re-wrapped twice. The run is an admin background job
   (`maintenance.master-key-rotation`), says how many rows it re-wrapped and how many are left, writes
   `master_key.rotate` per batch and one `master_key.rotate.summary` to `admin_audit`, and queues its next run
   when it stops at its batch bound. `--dry-run` only counts.
6. **Notices are re-sealed, not left behind.** The deleted-account notice holds the erased person's name and
   address directly under the master key, not under a user key, so a run also re-seals every pending
   (`queued`, `running`, `failed` or `dead`) notice under the current key. Without that, retiring the old key
   after the last `user_keys` row rotated would strand a notice that `admin_audit` and the erasure plan still
   expect to send.
7. **Secrets move together, then retire from the bottom.** The release that accepts the chain is deployed
   first, then `MASTER_KEY_V2` and `MASTER_KEY_CURRENT=2` are set in one secret update (V1 stays), the rotation
   re-wraps the rows still on V1 and re-seals notices, and `MASTER_KEY_V1` is removed once the job reports no
   rows or notices left. Retiring a secret before its rows are re-wrapped stops boot with the key name and row
   count. `docs/DEPLOY.md` carries the operator runbook.

## Considered Options

- Re-seal every encrypted value under the new key as well: the DEK is what protects the data, so re-sealing
  every facts, mail and resume row would be a much larger, longer outage for no cryptographic gain.
- Require `MASTER_KEY_V1` forever as the bottom of the chain: it keeps a possibly compromised key alive with no
  way to retire it, which is the gap this decision closes.
- Rotate from a request handler: rotation writes many rows and must survive a crash; the background job already
  has bounded batches, retries and the admin audit trail.
