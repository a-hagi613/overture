import { copy } from "../../../shared/copy.ts";
import { loadGrants } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { GrantLine } from "./grant-line.tsx";
import { NewGrantLine } from "./new-grant-line.tsx";

export function GrantsPage() {
  const { data, refusal, refresh } = useAdminResource(loadGrants);

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

  if (data === null) {
    return null;
  }

  const rows = data.grants;

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.grantsTitleItalic}
        lead={copy.admin.grantsLead}
        plain={copy.admin.grantsTitlePlain}
      />
      <section
        aria-labelledby="admin-grants"
        className="mt-7 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="admin-grants" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.grantsHeading}
          </h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.admin.folio1}
          </span>
        </div>
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
