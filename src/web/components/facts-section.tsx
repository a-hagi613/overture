import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { factLabelFor, isTier2FactKey, TIER_1_FACT_KEYS } from "../../shared/facts.ts";
import { fetchProfileFacts, fetchStrengthen, saveProfileFacts } from "../lib/profile-api.ts";
import { FactRow } from "./fact-row.tsx";
import { SourceChip } from "./source-chip.tsx";
import { StrengthenFacts } from "./strengthen-facts.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { SegmentedControl } from "./ui/segmented-control.tsx";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";
import { SectionSkeleton } from "./section-skeleton.tsx";

type Tier = "tier1" | "tier2" | "tier3";

const TIER_1_ORDER: readonly string[] = [...TIER_1_FACT_KEYS];
const INITIAL_VISIBLE_FACTS = 6;

function isTier(value: string): value is Tier {
  return value === "tier1" || value === "tier2" || value === "tier3";
}

function readableFactKey(key: string) {
  const clean = key.startsWith("q:") ? key.slice(2) : key;

  return clean.replaceAll(/[_-]+/gu, " ").replace(/^\w/u, (letter) => letter.toUpperCase());
}

function chipForFactSource(source: string | undefined, key: string) {
  const { facts } = copy.profile;

  if (source === "resume") {
    return <SourceChip>{facts.fromResume}</SourceChip>;
  }

  if (key === "apply_email") {
    return <SourceChip variant="dashed">{facts.assignedBy}</SourceChip>;
  }

  return <SourceChip variant="dashed">{facts.typedHere}</SourceChip>;
}

function tier1SortOrder(key: string) {
  const index = TIER_1_ORDER.indexOf(key);

  return index === -1 ? TIER_1_ORDER.length : index;
}

export function FactsSection() {
  const { facts } = copy.profile;
  const pw = copy.profileWorkspace;
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<Tier>(hash === "#profile-strengthen" ? "tier2" : "tier1");
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  const [expandedTiers, setExpandedTiers] = useState<{ tier1: boolean; tier3: boolean }>({
    tier1: false,
    tier3: false,
  });

  const factsQuery = useQuery({
    queryFn: fetchProfileFacts,
    queryKey: ["profile-facts"],
  });

  const strengthenQuery = useQuery({
    queryFn: fetchStrengthen,
    queryKey: ["profile-strengthen"],
  });

  const save = useMutation({
    mutationFn: saveProfileFacts,
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile-facts"], updated);
      void queryClient.invalidateQueries({ queryKey: ["ready"] });
      void queryClient.invalidateQueries({ queryKey: ["nav"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-skip-companies"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-strengthen"] });
    },
  });

  const allServerFacts = (factsQuery.data?.facts ?? []).filter(
    (entry) => entry.key !== "cover_letter_template",
  );

  const learnedFacts = allServerFacts.filter(
    (entry) => entry.key.startsWith("q:") || entry.source === "review",
  );

  const tier2Answered = allServerFacts.filter(
    (entry) =>
      !entry.key.startsWith("q:") && entry.source !== "review" && isTier2FactKey(entry.key),
  );

  const tier1Facts = allServerFacts
    .filter(
      (entry) =>
        !entry.key.startsWith("q:") && entry.source !== "review" && !isTier2FactKey(entry.key),
    )
    .toSorted((left, right) => tier1SortOrder(left.key) - tier1SortOrder(right.key));

  const visibleTier1 = expandedTiers.tier1
    ? tier1Facts
    : tier1Facts.slice(0, INITIAL_VISIBLE_FACTS);

  const visibleTier3 = expandedTiers.tier3
    ? learnedFacts
    : learnedFacts.slice(0, INITIAL_VISIBLE_FACTS);

  const tier2RemainingCount = strengthenQuery.data?.facts.length ?? 0;
  const tier2TotalCount = tier2Answered.length + tier2RemainingCount;

  const tier2CountText =
    strengthenQuery.data === undefined
      ? String(tier2Answered.length)
      : `${String(tier2Answered.length)}/${String(tier2TotalCount)}`;

  const clearLocalEdit = (key: string) => {
    setLocalEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key)),
    );
  };

  const persistFact = (key: string, label: string, nextValue: string, scope: string) => {
    const previousValue = localEdits[key];

    setLocalEdits((current) => ({ ...current, [key]: nextValue }));

    save.mutate([{ key, scope, value: nextValue }], {
      onError: () => {
        if (previousValue === undefined) {
          clearLocalEdit(key);
        } else {
          setLocalEdits((current) => ({ ...current, [key]: previousValue }));
        }

        toast.error(copy.profile.saveFailed);
      },
      onSuccess: () => {
        clearLocalEdit(key);
        toast.success(pw.factSavedToast(label));
      },
    });
  };

  if (factsQuery.isPending) {
    return <SectionSkeleton />;
  }

  return (
    <Card ariaLabelledBy="profile-facts-heading" className="p-5 md:p-6" id="profile-facts">
      <h2 className={dsCardTitle} id="profile-facts-heading">
        {`${facts.titlePlain} ${facts.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{facts.intro}</p>

      <div className="mt-5">
        <SegmentedControl
          ariaLabel={facts.tiersLabel}
          className="flex w-full flex-wrap gap-1 max-md:flex-col max-md:items-stretch"
          onValueChange={(value) => {
            if (isTier(value)) {
              setTier(value);
            }
          }}
          value={tier}
        >
          <SegmentedControlItem
            className="flex-1 px-2.5 text-xs whitespace-nowrap max-md:w-full max-md:flex-none"
            value="tier1"
          >
            {`${facts.tier1.label} (${String(tier1Facts.length)})`}
          </SegmentedControlItem>
          <SegmentedControlItem
            className="flex-1 px-2.5 text-xs whitespace-nowrap max-md:w-full max-md:flex-none"
            value="tier2"
          >
            {`${facts.tier2.label} (${tier2CountText})`}
          </SegmentedControlItem>
          <SegmentedControlItem
            className="flex-1 px-2.5 text-xs whitespace-nowrap max-md:w-full max-md:flex-none"
            value="tier3"
          >
            {`${facts.tier3.label} (${String(learnedFacts.length)})`}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>

      {tier === "tier1" ? (
        <div className="mt-4">
          <p className="max-w-2xl text-xs text-muted-foreground">{facts.tier1.note}</p>
          {tier1Facts.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">{pw.tier1Empty}</p>
            </div>
          ) : (
            <div className="mt-3">
              {visibleTier1.map((fact) => {
                const label = factLabelFor(fact.key) || readableFactKey(fact.key);
                const resolvedValue = localEdits[fact.key] ?? fact.value;
                const readOnly = fact.key === "apply_email";

                const note =
                  fact.scope === "" || fact.scope === "default"
                    ? ""
                    : `${pw.factScopeAccount} · ${fact.scope}`;

                return (
                  <FactRow
                    action={readOnly ? "read-only" : "edit"}
                    chip={chipForFactSource(fact.source, fact.key)}
                    key={`${fact.key}:${fact.scope}`}
                    kind={fact.key === "apply_email" || fact.key === "email" ? "mono" : "serif"}
                    label={label}
                    note={note}
                    onSave={(nextValue) => {
                      persistFact(fact.key, label, nextValue, fact.scope);
                    }}
                    saving={save.isPending}
                    value={resolvedValue}
                  />
                );
              })}
              {tier1Facts.length > INITIAL_VISIBLE_FACTS ? (
                <div className="border-t border-border pt-3">
                  <Button
                    onClick={() => {
                      setExpandedTiers((current) => ({ ...current, tier1: !current.tier1 }));
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {expandedTiers.tier1
                      ? facts.showLess
                      : facts.showMore(tier1Facts.length - INITIAL_VISIBLE_FACTS)}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">{facts.tier1.foot}</p>
            <div className="flex flex-wrap gap-2">
              <SourceChip>{facts.fromResume}</SourceChip>
              <SourceChip variant="dashed">{facts.typedHere}</SourceChip>
            </div>
          </div>
        </div>
      ) : null}

      {tier === "tier2" ? (
        <div id="profile-strengthen">
          <StrengthenFacts />
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">{facts.strengthen.foot}</p>
          </div>
        </div>
      ) : null}

      {tier === "tier3" ? (
        <div className="mt-4">
          {learnedFacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-5 py-8 text-center">
              <p className="text-sm font-semibold text-foreground">
                {copy.nav.profilePages.tier3EmptyTitle}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {copy.nav.profilePages.tier3EmptyBody}
              </p>
              <Button asChild className="mt-4" size="sm" variant="outline">
                <Link to="/review">
                  <span>{copy.nav.profilePages.tier3OpenReview}</span>
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </Button>
            </div>
          ) : (
            <div>
              {visibleTier3.map((fact) => {
                const label = readableFactKey(fact.key);
                const resolvedValue = localEdits[fact.key] ?? fact.value;

                return (
                  <FactRow
                    action="edit"
                    chip={<SourceChip variant="dashed">{facts.typedHere}</SourceChip>}
                    key={`${fact.key}:${fact.scope}`}
                    label={label}
                    note={pw.factReusedHint}
                    onSave={(nextValue) => {
                      persistFact(fact.key, label, nextValue, fact.scope);
                    }}
                    saving={save.isPending}
                    value={resolvedValue}
                  />
                );
              })}
              {learnedFacts.length > INITIAL_VISIBLE_FACTS ? (
                <div className="border-t border-border pt-3">
                  <Button
                    onClick={() => {
                      setExpandedTiers((current) => ({ ...current, tier3: !current.tier3 }));
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {expandedTiers.tier3
                      ? facts.showLess
                      : facts.showMore(learnedFacts.length - INITIAL_VISIBLE_FACTS)}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
