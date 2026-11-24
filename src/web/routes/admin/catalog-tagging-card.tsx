import type { TaggingReport } from "../../../shared/tagging-report.ts";

import { copy } from "../../../shared/copy.ts";
import { dsEyebrow } from "../../components/ui/ds.ts";

const numberFormat = new Intl.NumberFormat("en-US");

const moneyFormat = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

/**
 * The WS-17a classification funnel and its Tier 3 cost, read from the active catalog's manifest (WS-17b). A catalog
 * published before WS-17a, or one whose manifest has no `tagging` block, shows one muted sentence instead of zeros,
 * so the page never implies a classification run that did not happen.
 * @param props The manifest version and the tag report, both possibly absent.
 * @param props.manifestVersion The published catalog version, or null.
 * @param props.tagging The classification report, or null.
 * @returns The classification section on the admin catalog page.
 */
export function CatalogTaggingCard({
  manifestVersion,
  tagging,
}: {
  manifestVersion: string | null;
  tagging: TaggingReport | null;
}) {
  const rows =
    tagging === null
      ? []
      : [
          { label: copy.admin.catalogTaggingTotal, value: tagging.total_postings },
          { label: copy.admin.catalogTaggingDupes, value: tagging.cross_board_dupes_removed },
          { label: copy.admin.catalogTaggingPairs, value: tagging.unique_title_dept_pairs },
          { label: copy.admin.catalogTaggingCacheHits, value: tagging.cache_hit },
          { label: copy.admin.catalogTaggingTier1, value: tagging.tier1_esco_rules },
          { label: copy.admin.catalogTaggingTier2, value: tagging.tier2_embeddings },
          { label: copy.admin.catalogTaggingTier3Sent, value: tagging.tier3_haiku_batch_sent },
          { label: copy.admin.catalogTaggingTier3Resolved, value: tagging.tier3_haiku_resolved },
          { label: copy.admin.catalogTaggingUntagged, value: tagging.still_untagged },
        ];

  return (
    <section
      aria-labelledby="admin-catalog-tagging"
      className="mt-7 flex flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-card-title leading-[1.1]" id="admin-catalog-tagging">
          {copy.admin.catalogTaggingHeading}
        </h2>
        {manifestVersion === null ? null : (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {copy.admin.catalogTaggingVersion(manifestVersion)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{copy.admin.catalogTaggingLead}</p>

      {tagging === null ? (
        <p className="mt-1 text-sm text-muted-foreground">{copy.admin.catalogTaggingEmpty}</p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
            {rows.map((row) => (
              <div
                className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0"
                key={row.label}
              >
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-foreground">
                  {numberFormat.format(row.value)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-lg border border-border bg-muted px-4 py-3">
            <span className={dsEyebrow}>{copy.admin.catalogTaggingSpend}</span>
            <span className="font-serif text-card-title leading-none tabular-nums text-foreground">
              {moneyFormat.format(tagging.tier3_cost_usd)}
            </span>
            <span className="text-xs text-muted-foreground">
              {copy.admin.catalogTaggingTokens(tagging.input_tokens, tagging.output_tokens)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
