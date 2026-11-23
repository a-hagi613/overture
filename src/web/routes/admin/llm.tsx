import { useCallback } from "react";
import { Link, useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { fetchAdminLlmUsage } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { LlmBreakdowns } from "./llm-breakdowns.tsx";
import { LlmCallLog } from "./llm-call-log.tsx";
import { formatUsdMicros } from "./llm-format.ts";
import { LlmSummaryCards } from "./llm-summary-cards.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md border border-input bg-card px-3.5 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9";

export function LlmUsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const purpose = searchParams.get("purpose") ?? "";

  const load = useCallback(
    async () =>
      await fetchAdminLlmUsage({
        purpose: purpose.length > 0 ? purpose : undefined,
      }),
    [purpose],
  );

  const { data, refusal, refresh } = useAdminResource(load, ["llm-usage", purpose]);

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

  const selectPurpose = (nextPurpose: string) => {
    const next = new URLSearchParams();

    if (nextPurpose.length > 0) {
      next.set("purpose", nextPurpose);
    }

    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.llmTitleItalic}
        lead={copy.admin.llmLead}
        plain={copy.admin.llmTitlePlain}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className={NAV_LINK_CLASS} to="/admin/settings">
          {copy.admin.llmOpenSettings}
        </Link>
        <Link className={NAV_LINK_CLASS} to="/admin/provider-report">
          {copy.admin.llmOpenReport}
        </Link>
      </div>

      <LlmSummaryCards view={data} />

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        {copy.admin.llmCapsFootnote(
          formatUsdMicros(data.caps.userDailyCapMicros),
          formatUsdMicros(data.caps.taggingDailyCapMicros),
        )}
      </p>

      <LlmBreakdowns
        activePurpose={purpose}
        byModel={data.byModel}
        byPurpose={data.byPurpose}
        expectedModel={data.expectedModel}
        onSelectPurpose={selectPurpose}
      />

      <LlmCallLog
        activePurpose={purpose}
        expectedModel={data.expectedModel}
        now={data.now}
        onClearPurpose={() => {
          selectPurpose("");
        }}
        rows={data.rows}
      />
    </>
  );
}
