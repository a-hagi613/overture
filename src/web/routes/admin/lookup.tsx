import { useState } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { AdminPageHeading } from "./page-heading.tsx";
import { LookupResult } from "./lookup-result.tsx";

const CARD = "rounded-lg border border-border bg-card px-6 py-5 shadow-sh";

const FIELD =
  "min-h-11 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

const BUTTON =
  "min-h-11 rounded-md border border-input bg-card px-4 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

export function ApplicationLookupPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const applicationId = searchParams.get("application")?.trim() ?? "";
  const [draft, setDraft] = useState(applicationId);

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();

    const next = new URLSearchParams(searchParams);
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      next.delete("application");
    } else {
      next.set("application", trimmed);
    }

    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.lookupTitleItalic}
        lead={copy.admin.lookupLead}
        plain={copy.admin.lookupTitlePlain}
      />
      <p className="mt-2 max-w-[62ch] text-sm text-muted-foreground">{copy.admin.lookupIntro}</p>

      <form className={`mt-5 ${CARD}`} onSubmit={submit}>
        <label className="block text-xs font-semibold" htmlFor="lookup-application">
          {copy.admin.lookupLabel}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${FIELD} min-w-0 flex-1 font-mono`}
            id="lookup-application"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.admin.lookupPlaceholder}
            value={draft}
          />
          <button className={BUTTON} type="submit">
            {copy.admin.lookupSubmit}
          </button>
        </div>
      </form>

      {applicationId.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">{copy.admin.lookupMissing}</p>
      ) : (
        <LookupResult applicationId={applicationId} />
      )}
    </>
  );
}
