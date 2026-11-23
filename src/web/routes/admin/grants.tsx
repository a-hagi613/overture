import { copy } from "../../../shared/copy.ts";
import { loadGrants } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { GrantLine } from "./grant-line.tsx";
import { NewGrantLine } from "./new-grant-line.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

export function GrantsPage() {
  const { data, failed, refusal, refresh } = useAdminResource(loadGrants);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          refresh();
        }}
      />
    );
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.grantsTitleItalic}
      lead={copy.admin.grantsLead}
      plain={copy.admin.grantsTitlePlain}
    />
  );

  if (failed || data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard failed={failed} onRetry={refresh} />
      </>
    );
  }

  const rows = data.grants;

  return (
    <>
      {heading}
      <section
        aria-labelledby="admin-grants"
        className="mt-7 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <h2 id="admin-grants" className="font-serif text-[26px] leading-[1.1]">
          {copy.admin.grantsHeading}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.admin.grantsIntro}</p>
        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">{copy.admin.grantEmpty}</p>
          ) : (
            rows.map((row) => <GrantLine key={row.id} row={row} />)
          )}
        </div>
        <NewGrantLine
          onChanged={() => {
            refresh();
          }}
        />
      </section>
    </>
  );
}
