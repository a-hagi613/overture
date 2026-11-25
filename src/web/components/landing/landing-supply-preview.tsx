import { useState } from "react";

import type { SupplyCounts } from "../../../shared/supply.ts";
import type { RoleCategoryId } from "../../../shared/role-taxonomy.ts";

import { roleCategoryOf } from "../../../shared/role-taxonomy.ts";
import { LANDING_COPY } from "./landing-copy.ts";
import { LandingSupplyFilters } from "./landing-supply-filters.tsx";
import { LandingSupplyStatus } from "./landing-supply-status.tsx";
import { LandingWhereItApplies } from "./landing-where-it-applies.tsx";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dsContainer, dsLead, dsSectionHeading } from "../ui/ds.ts";
import { useSupplyCounts } from "../../lib/supply-api.ts";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function statusOf(counts: SupplyCounts | null, failed: boolean, loading: boolean) {
  if (counts !== null) {
    return "ready";
  }

  if (failed) {
    return "failed";
  }

  return loading ? "loading" : "idle";
}

/**
 * The public landing's live supply preview (issue #567). It asks only the read-only `/api/supply`
 * endpoint for an aggregate count of open, apply-supported roles, so a signed-out visitor learns what
 * Overture can act on today without a session.
 * @returns The Live Jobs preview section on the landing.
 */
export function LandingSupplyPreview() {
  const [category, setCategory] = useState<RoleCategoryId | null>(null);
  const [granularRole, setGranularRole] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);

  const { counts, failed, loading, retry } = useSupplyCounts({
    granularRole,
    location,
    remote,
    role: category,
  });

  const status = statusOf(counts, failed, loading);

  const captions = {
    ready: LANDING_COPY.supply.countSuffix,
    failed: LANDING_COPY.supply.failed,
    loading: LANDING_COPY.supply.loading,
    idle: LANDING_COPY.supply.idle,
  };

  const updatedAt = counts === null ? null : timeFormat.format(new Date(counts.generatedAt));

  return (
    <section
      aria-labelledby="supply-preview-title"
      className="border-t border-border bg-background py-14 text-foreground sm:py-20"
      id="live-jobs"
    >
      <div className={dsContainer}>
        <div className="mx-auto max-w-2xl text-center">
          <Badge size="eyebrow" variant="signal">
            {LANDING_COPY.supply.badge}
          </Badge>
          <h2 className={`${dsSectionHeading} mt-4 text-balance`} id="supply-preview-title">
            {LANDING_COPY.supply.headingPlain}
            <span className="italic">{LANDING_COPY.supply.headingItalic}</span>
          </h2>
          <p className={`${dsLead} mx-auto mt-3 max-w-xl`}>{LANDING_COPY.supply.lead}</p>
        </div>

        <div className="mt-10">
          <LandingWhereItApplies />
        </div>

        <Card
          ariaBusy={loading}
          className="mt-8 px-5 py-6 sm:px-8 sm:py-7 lg:px-10"
          variant="elevated"
        >
          <LandingSupplyFilters
            category={category}
            granularRole={granularRole}
            location={location}
            onCategoryChange={(next) => {
              setCategory(next);
              setGranularRole((current) =>
                current !== null && next !== null && roleCategoryOf(current) !== next
                  ? null
                  : current,
              );
            }}
            onGranularRoleChange={setGranularRole}
            onLocationSelect={setLocation}
            onRemoteChange={setRemote}
            remote={remote}
          />
          <LandingSupplyStatus
            caption={captions[status]}
            live={status === "ready" && !failed}
            onRetry={retry}
            retryVisible={status === "failed"}
            updatedAt={updatedAt}
            value={counts === null ? "—" : counts.total.toLocaleString("en-US")}
          />
        </Card>
      </div>
    </section>
  );
}
