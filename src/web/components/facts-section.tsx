import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { factLabelFor, isTier2FactKey, TIER_1_FACT_KEYS } from "../../shared/facts.ts";
import {
  KEY_DETAIL_FACT_KEYS,
  KEY_DETAIL_FACT_LABELS,
  isKeyDetailFactKey,
} from "../../shared/key-details.ts";
import { fetchProfileFacts, saveProfileFacts } from "../lib/profile-api.ts";
import { FactRow } from "./fact-row.tsx";
import { SourceChip } from "./source-chip.tsx";
import { StrengthenFacts } from "./strengthen-facts.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { SectionSkeleton } from "./section-skeleton.tsx";

const TIER_1_ORDER: readonly string[] = [...TIER_1_FACT_KEYS];
const INITIAL_VISIBLE_FACTS = 6;

function keyDetailFactFor<T extends { key: string; scope: string }>(
  facts: readonly T[],
  key: string,
) {
  const candidates = facts.filter((fact) => fact.key === key);

  return candidates.find((fact) => fact.scope === "") ?? candidates[0];
}

function readableFactKey(key: string) {
  const clean = key.startsWith("q:") ? key.slice(2) : key;

  return clean.replaceAll(/[_-]+/gu, " ").replace(/^\w/u, (letter) => letter.toUpperCase());
}

function chipForFactSource(source: string | undefined) {
  const { facts } = copy.profile;

  return source === "resume" ? (
    <SourceChip>{facts.fromResume}</SourceChip>
  ) : (
    <SourceChip>{facts.typedHere}</SourceChip>
  );
}

function tier1SortOrder(key: string) {
  const index = TIER_1_ORDER.indexOf(key);

  return index === -1 ? TIER_1_ORDER.length : index;
}

export function FactsSection() {
  const { facts } = copy.profile;
  const pw = copy.profileWorkspace;
  const queryClient = useQueryClient();
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const [expandedOthers, setExpandedOthers] = useState(false);
  const [expandedLearned, setExpandedLearned] = useState(false);

  const factsQuery = useQuery({
    queryFn: fetchProfileFacts,
    queryKey: ["profile-facts"],
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

  const tier1Facts = allServerFacts
    .filter(
      (entry) =>
        !entry.key.startsWith("q:") && entry.source !== "review" && !isTier2FactKey(entry.key),
    )
    .toSorted((left, right) => tier1SortOrder(left.key) - tier1SortOrder(right.key));

  const otherFacts = tier1Facts.filter((entry) => !isKeyDetailFactKey(entry.key));

  const visibleOthers = expandedOthers ? otherFacts : otherFacts.slice(0, INITIAL_VISIBLE_FACTS);

  const visibleLearned = expandedLearned
    ? learnedFacts
    : learnedFacts.slice(0, INITIAL_VISIBLE_FACTS);

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
      <p className={`${dsBody} mt-1`}>{facts.intro}</p>

      <section className="mt-6">
        <h3 className={dsCardTitle} id="profile-key-details-heading">
          {facts.keyDetails}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{facts.keyDetailsNote}</p>
        <div className="mt-3" id="profile-key-details-list">
          {KEY_DETAIL_FACT_KEYS.map((key) => {
            const label = KEY_DETAIL_FACT_LABELS[key];
            const fact = keyDetailFactFor(allServerFacts, key);
            const resolvedValue = localEdits[key] ?? fact?.value ?? "";

            const note =
              fact === undefined || fact.scope === "" || fact.scope === "default"
                ? ""
                : `${pw.factScopeAccount} · ${fact.scope}`;

            return (
              <FactRow
                action="edit"
                chip={
                  fact === undefined ? (
                    <SourceChip>{facts.notSet}</SourceChip>
                  ) : (
                    chipForFactSource(fact.source)
                  )
                }
                key={key}
                kind={key === "email" ? "mono" : "serif"}
                label={label}
                note={note}
                onSave={(nextValue) => {
                  persistFact(key, label, nextValue, fact?.scope ?? "");
                }}
                saving={save.isPending}
                value={resolvedValue}
              />
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{facts.coreNote}</p>
      </section>

      {otherFacts.length === 0 ? null : (
        <section className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={dsCardTitle}>{facts.otherSaved}</h3>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {String(otherFacts.length)}
            </span>
          </div>
          <div className="mt-3">
            {visibleOthers.map((fact) => {
              const label = factLabelFor(fact.key) || readableFactKey(fact.key);
              const resolvedValue = localEdits[fact.key] ?? fact.value;

              const note =
                fact.scope === "" || fact.scope === "default"
                  ? ""
                  : `${pw.factScopeAccount} · ${fact.scope}`;

              return (
                <FactRow
                  action="edit"
                  chip={chipForFactSource(fact.source)}
                  key={`${fact.key}:${fact.scope}`}
                  kind={fact.key === "email" ? "mono" : "serif"}
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
            {otherFacts.length > INITIAL_VISIBLE_FACTS ? (
              <div className="border-t border-border pt-3">
                <Button
                  onClick={() => {
                    setExpandedOthers((current) => !current);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {expandedOthers
                    ? facts.showLess
                    : facts.showMore(otherFacts.length - INITIAL_VISIBLE_FACTS)}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <section className="mt-6 border-t border-border pt-5" id="profile-strengthen">
        <h3 className={dsCardTitle}>{facts.strengthen.heading}</h3>
        <StrengthenFacts />
        <p className="mt-4 text-xs text-muted-foreground">{facts.strengthen.foot}</p>
      </section>

      <section className="mt-6 border-t border-border pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={dsCardTitle}>{facts.learned.heading}</h3>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {String(learnedFacts.length)}
          </span>
        </div>
        {learnedFacts.length === 0 ? (
          <div className="mt-3">
            <p className="text-sm font-semibold text-foreground">{facts.learned.emptyTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{facts.learned.emptyBody}</p>
            <Button asChild className="mt-3" size="sm" variant="outline">
              <Link to="/review">
                <span>{facts.learned.openReview}</span>
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            {visibleLearned.map((fact) => {
              const label = readableFactKey(fact.key);
              const resolvedValue = localEdits[fact.key] ?? fact.value;

              return (
                <FactRow
                  action="edit"
                  chip={<SourceChip>{facts.typedHere}</SourceChip>}
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
                    setExpandedLearned((current) => !current);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {expandedLearned
                    ? facts.showLess
                    : facts.showMore(learnedFacts.length - INITIAL_VISIBLE_FACTS)}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">{facts.foot}</p>
        <div className="flex flex-wrap gap-2">
          <SourceChip>{facts.fromResume}</SourceChip>
          <SourceChip>{facts.typedHere}</SourceChip>
        </div>
      </div>
    </Card>
  );
}
