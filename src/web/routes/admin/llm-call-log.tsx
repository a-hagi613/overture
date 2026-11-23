import { copy } from "../../../shared/copy.ts";
import type { LlmUsageRow } from "../../lib/admin-api.ts";
import { LlmCallMobileItem } from "./llm-call-mobile-item.tsx";
import { LlmCallTableRow } from "./llm-call-table-row.tsx";

export function LlmCallLog({
  activePurpose,
  expectedModel,
  now,
  onClearPurpose,
  rows,
}: {
  activePurpose: string;
  expectedModel: string;
  now: number;
  onClearPurpose: () => void;
  rows: LlmUsageRow[];
}) {
  return (
    <section aria-labelledby="admin-llm-recent-heading" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-[24px] leading-[1.1]" id="admin-llm-recent-heading">
          {copy.admin.llmRecentHeading}
        </h2>
        {activePurpose.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1 font-mono text-[12px] text-foreground">
              {copy.admin.llmFilterActive(activePurpose)}
            </span>
            <button
              className="min-h-11 rounded-md border border-input bg-card px-3.5 text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
              onClick={onClearPurpose}
              type="button"
            >
              {copy.admin.llmFilterClear}
            </button>
          </div>
        ) : null}
      </div>

      <ul
        aria-label={copy.admin.llmRecentHeading}
        className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sh md:hidden"
      >
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-[13px] text-muted-foreground">
            {copy.admin.llmRecentEmpty}
          </li>
        ) : (
          rows.map((row) => (
            <LlmCallMobileItem expectedModel={expectedModel} key={row.id} now={now} row={row} />
          ))
        )}
      </ul>

      <div
        className="mt-3 hidden overflow-x-auto rounded-lg border border-border bg-card shadow-sh md:block"
        data-scroll-region=""
      >
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead className="bg-muted text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5" scope="col">
                {copy.admin.llmRecentColumnTime}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmColumnPurpose}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmColumnModel}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmRecentColumnInput}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmRecentColumnCached}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmRecentColumnOutput}
              </th>
              <th className="px-3 py-2.5" scope="col">
                {copy.admin.llmColumnCacheHit}
              </th>
              <th className="px-4 py-2.5" scope="col">
                {copy.admin.llmColumnCost}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                  {copy.admin.llmRecentEmpty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <LlmCallTableRow expectedModel={expectedModel} key={row.id} now={now} row={row} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
