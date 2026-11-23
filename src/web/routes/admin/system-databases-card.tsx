import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { SystemReport } from "../../lib/admin-api.ts";
import { runWalCheckpoint } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { systemButtonClass } from "./system-classes.ts";
import { SystemDatabaseCard } from "./system-database-card.tsx";
import { SystemField } from "./system-field.tsx";

const FREELIST_WARNING_BYTES = 50 * 1_048_576;

export function SystemDatabasesCard({
  refresh,
  view,
}: {
  refresh: () => void;
  view: SystemReport;
}) {
  const [checkpointing, setCheckpointing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const now = view.generatedAt;

  const freelistWarning =
    (view.databases.app?.freeBytes ?? 0) > FREELIST_WARNING_BYTES ||
    (view.databases.catalog?.freeBytes ?? 0) > FREELIST_WARNING_BYTES;

  const checkpoint = async () => {
    setCheckpointing(true);
    setNote(null);

    try {
      const report = await runWalCheckpoint();

      setNote(
        report.busy === 0
          ? copy.admin.systemWalCheckpointDone(
              copy.admin.systemMegabytes(report.beforeWalBytes),
              copy.admin.systemMegabytes(report.afterWalBytes),
            )
          : copy.admin.systemWalCheckpointBusy,
      );
      refresh();
    } catch {
      setNote(copy.admin.systemWalCheckpointFailed);
    }

    setCheckpointing(false);
  };

  return (
    <section
      aria-labelledby="admin-system-databases"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
    >
      <h2 className="font-serif text-card-title leading-[1.1]" id="admin-system-databases">
        {copy.admin.systemDatabasesHeading}
      </h2>
      {freelistWarning ? (
        <output className="mt-3 block rounded-md bg-need-soft p-3 text-xs font-medium text-need">
          {copy.admin.systemFreelistWarning(
            copy.admin.systemMegabytes(
              Math.max(view.databases.app?.freeBytes ?? 0, view.databases.catalog?.freeBytes ?? 0),
            ),
          )}
        </output>
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SystemDatabaseCard name={copy.admin.systemAppDatabase} sizes={view.databases.app} />
        <SystemDatabaseCard
          name={copy.admin.systemCatalogDatabase}
          sizes={view.databases.catalog}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className={systemButtonClass}
          disabled={checkpointing}
          onClick={() => {
            void checkpoint();
          }}
          type="button"
        >
          {checkpointing ? copy.admin.systemWalCheckpointRunning : copy.admin.systemWalCheckpoint}
        </button>
        <output aria-live="polite" className="text-xs text-muted-foreground">
          {note ?? ""}
        </output>
      </div>
      <h3 className="mt-6 font-serif text-base leading-[1.2]">{copy.admin.systemVolumeHeading}</h3>
      {view.volume === null ? (
        <p className="mt-2 text-xs text-muted-foreground">{copy.admin.systemVolumeNone}</p>
      ) : (
        <div className="mt-2">
          <dl className="max-w-[560px]">
            <SystemField label={copy.admin.systemVolumeMount} value={view.volume.mount} />
            <SystemField
              label={copy.admin.systemVolumeFree}
              value={copy.admin.systemGigabytes(view.volume.freeBytes)}
            />
            <SystemField
              label={copy.admin.systemVolumeUsed}
              value={copy.admin.systemPercent(view.volume.usedRatio)}
            />
          </dl>
          <div
            aria-hidden="true"
            className="mt-2 h-2 w-full max-w-[560px] overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground"
              style={{ width: copy.admin.systemPercent(view.volume.usedRatio) }}
            />
          </div>
        </div>
      )}
      <h3 className="mt-6 font-serif text-base leading-[1.2]">{copy.admin.systemCatalogHeading}</h3>
      <dl className="mt-1 max-w-[560px]">
        <SystemField label={copy.admin.systemCatalogBoards} value={String(view.catalog.boards)} />
        <SystemField
          label={copy.admin.systemCatalogOpen}
          value={String(view.catalog.openPostings)}
        />
        <SystemField
          label={copy.admin.systemCatalogClosed}
          value={String(view.catalog.closedPostings)}
        />
        <SystemField
          label={copy.admin.systemCatalogPolled}
          value={
            view.catalog.lastPolledAt === null
              ? copy.admin.systemNever
              : adminDayTime(view.catalog.lastPolledAt, now)
          }
        />
        <SystemField
          label={copy.admin.systemCatalogSeen}
          value={
            view.catalog.lastSeenAt === null
              ? copy.admin.systemNever
              : adminDayTime(view.catalog.lastSeenAt, now)
          }
        />
      </dl>
    </section>
  );
}
