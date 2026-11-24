import { useEffect, useState } from "react";

import type { SupplyCounts } from "../../../shared/supply.ts";
import type { RoleGroup } from "../../../shared/tag-taxonomy.ts";

import { escoRoleCategory } from "../../../shared/esco-roles.ts";
import { LANDING_COPY } from "./landing-copy.ts";
import { LandingSupplyFilters } from "./landing-supply-filters.tsx";
import { LandingSupplyStatus } from "./landing-supply-status.tsx";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { dsContainer, dsLead, dsSectionHeading } from "../ui/ds.ts";
import { useSupplyCounts } from "../../lib/supply-api.ts";

const LOCATION_DEBOUNCE_MS = 350;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function locationFromDraft(value: string) {
  const trimmed = value.trim();

  return trimmed.length >= 2 ? trimmed : null;
}

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
 * Overture can act on today without a session. Every state renders in the same reserved height: while the
 * count loads, when it fails (the app deploy or the static worker can be briefly ahead of the API), and
 * with JavaScript off, the card shows a sentence instead of an empty number.
 * @returns The supply preview section on the landing.
 */
export function LandingSupplyPreview() {
  const [category, setCategory] = useState<RoleGroup | null>(null);
  const [granularRole, setGranularRole] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [radius, setRadius] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setLocation(locationFromDraft(locationDraft));
    }, LOCATION_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [locationDraft]);

  const { counts, failed, loading, retry } = useSupplyCounts({
    granularRole,
    location,
    radius,
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
      className={`${dsContainer} pb-6 pt-4 sm:pb-8 sm:pt-6`}
      id="live-jobs"
    >
      <Card ariaBusy={loading} className="px-5 py-7 sm:px-8 sm:py-9 lg:px-10" variant="elevated">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
          <div>
            <Badge size="eyebrow" variant="signal">
              {LANDING_COPY.supply.badge}
            </Badge>
            <h2 className={`${dsSectionHeading} mt-4 text-balance`} id="supply-preview-title">
              {LANDING_COPY.supply.headingPlain}
              <span className="italic">{LANDING_COPY.supply.headingItalic}</span>
            </h2>
            <p className={`${dsLead} mt-3 max-w-md`}>{LANDING_COPY.supply.lead}</p>
          </div>
          <div>
            <LandingSupplyFilters
              category={category}
              granularRole={granularRole}
              locationDraft={locationDraft}
              onCategoryChange={(next) => {
                setCategory(next);
                setGranularRole((current) =>
                  current !== null && next !== null && escoRoleCategory(current) !== next
                    ? null
                    : current,
                );
              }}
              onGranularRoleChange={setGranularRole}
              onLocationChange={setLocationDraft}
              onRadiusChange={setRadius}
              onRemoteChange={setRemote}
              radius={radius}
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
          </div>
        </div>
      </Card>
    </section>
  );
}
