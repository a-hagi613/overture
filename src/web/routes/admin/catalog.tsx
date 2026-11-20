import { copy } from "../../../shared/copy.ts";
import { loadCatalog } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { CatalogLine } from "./catalog-line.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";

export function CatalogPage() {
  const { data, refusal, refresh } = useAdminResource(loadCatalog);

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

  const view = data;

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.catalogTitleItalic}
        lead={copy.admin.catalogLead}
        plain={copy.admin.catalogTitlePlain}
      />
      <section
        aria-labelledby="admin-catalog-health"
        className="mt-7 flex flex-col gap-5 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="admin-catalog-health" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.catalogSectionHeading}
          </h2>
          <span className="font-serif text-sm italic text-muted-foreground">
            {copy.admin.folio1}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {copy.admin.catalogNotDiscovered}
        </p>
        <div className="mt-4">
          {view.ats.map((entry) => (
            <CatalogLine
              ats={entry.ats}
              hourlyLimit={entry.hourlyLimit}
              key={entry.ats}
              killState={entry.killSwitchEnabled}
            />
          ))}
        </div>
      </section>
    </>
  );
}
