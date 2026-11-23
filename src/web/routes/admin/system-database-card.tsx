import { copy } from "../../../shared/copy.ts";
import type { SystemReport } from "../../lib/admin-api.ts";
import { SystemField } from "./system-field.tsx";

export function SystemDatabaseCard({
  name,
  sizes,
}: {
  name: string;
  sizes: SystemReport["databases"]["app"];
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-[18px_20px]">
      <h3 className="font-mono text-sm font-semibold">{name}</h3>
      {sizes === null ? (
        <p className="mt-2 text-xs text-muted-foreground">{copy.admin.systemDatabaseMissing}</p>
      ) : (
        <dl className="mt-3">
          <SystemField
            label={copy.admin.systemDatabaseFile}
            value={copy.admin.systemMegabytes(sizes.fileBytes)}
          />
          <SystemField
            label={copy.admin.systemDatabaseWal}
            value={copy.admin.systemMegabytes(sizes.walBytes)}
          />
          <SystemField
            label={copy.admin.systemDatabaseFreelist}
            value={copy.admin.systemDatabaseFreelistValue(
              sizes.freelistCount,
              copy.admin.systemMegabytes(sizes.freeBytes),
            )}
          />
          <SystemField
            label={copy.admin.systemDatabasePages}
            value={copy.admin.systemDatabasePagesValue(sizes.pageCount, sizes.pageSize)}
          />
        </dl>
      )}
    </div>
  );
}
