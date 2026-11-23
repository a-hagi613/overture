import { copy } from "../../../shared/copy.ts";
import type { AttemptRow } from "../../lib/admin-api.ts";
import { AttemptTableRow } from "./attempt-row.tsx";

export function AttemptsTable({
  attempts,
  now,
  onFilterApplication,
  onInspectLive,
  onInspectReplay,
}: {
  attempts: AttemptRow[];
  now: number;
  onFilterApplication: (applicationId: string) => void;
  onInspectLive: (attempt: AttemptRow) => void;
  onInspectReplay: (attempt: AttemptRow) => void;
}) {
  return (
    <section
      aria-label={copy.admin.attemptsListLabel}
      className="mt-4 hidden overflow-x-auto rounded-lg border border-border bg-card shadow-sh md:block"
      data-scroll-region=""
    >
      <table className="w-full min-w-[780px] border-collapse text-left text-[13px]">
        <thead className="bg-muted text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5" scope="col">
              {copy.admin.attemptsColumnPosting}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnAts}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnProvider}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnOutcome}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnDuration}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnProxy}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnCost}
            </th>
            <th className="px-3 py-2.5" scope="col">
              {copy.admin.attemptsColumnStarted}
            </th>
            <th className="px-4 py-2.5" scope="col">
              {copy.admin.attemptsColumnSession}
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-muted-foreground" colSpan={9}>
                {copy.admin.attemptsEmpty}
              </td>
            </tr>
          ) : (
            attempts.map((attempt) => (
              <AttemptTableRow
                attempt={attempt}
                key={attempt.id}
                now={now}
                onFilterApplication={onFilterApplication}
                onInspectLive={onInspectLive}
                onInspectReplay={onInspectReplay}
              />
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
