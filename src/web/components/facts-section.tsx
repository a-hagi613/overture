import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { fetchProfileFacts, saveProfileFacts } from "../lib/profile-api.ts";
import { FactRow } from "./fact-row.tsx";
import { SourceChip } from "./source-chip.tsx";
import { StrengthenFacts } from "./strengthen-facts.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Tabs } from "./ui/tabs.tsx";
import { TabsList } from "./ui/tabs-list.tsx";
import { TabsTrigger } from "./ui/tabs-trigger.tsx";

type Tier = "tier1" | "tier2" | "tier3";

function isTier(value: string): value is Tier {
  return value === "tier1" || value === "tier2" || value === "tier3";
}

function chipForKind(kind: string) {
  const { facts } = copy.profile;

  if (kind === "fromResume") {
    return <SourceChip>{facts.fromResume}</SourceChip>;
  }

  if (kind === "typed") {
    return <SourceChip variant="dashed">{facts.typedHere}</SourceChip>;
  }

  return <SourceChip variant="dashed">{facts.assignedBy}</SourceChip>;
}

function keyForLabel(label: string) {
  return label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_|_$/gu, "");
}

function readableFactKey(key: string) {
  const clean = key.startsWith("q:") ? key.slice(2) : key;

  return clean.replaceAll(/[_-]+/gu, " ").replace(/^\w/u, (letter) => letter.toUpperCase());
}

export function FactsSection() {
  const { facts } = copy.profile;
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<Tier>(hash === "#profile-strengthen" ? "tier2" : "tier1");
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

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

  const allServerFacts = factsQuery.data?.facts ?? [];

  const learnedFacts = allServerFacts.filter(
    (entry) => entry.key.startsWith("q:") || entry.source === "review",
  );

  const serverByKey = new Map(allServerFacts.map((entry) => [entry.key, entry.value]));

  const clearLocalEdit = (key: string) => {
    setLocalEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key)),
    );
  };

  const persistFact = (key: string, label: string, nextValue: string) => {
    const previousValue = localEdits[key];

    setLocalEdits((current) => ({ ...current, [key]: nextValue }));

    save.mutate([{ key, value: nextValue }], {
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
        toast.success(`Saved ${label}.`);
      },
    });
  };

  return (
    <Card ariaLabelledBy="profile-facts-heading" className="mt-6 p-5 md:p-6" id="profile-facts">
      <h2 className={dsCardTitle} id="profile-facts-heading">
        {`${facts.titlePlain} ${facts.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{facts.intro}</p>

      <div className="mt-5">
        <Tabs
          onValueChange={(value) => {
            if (isTier(value)) {
              setTier(value);
            }
          }}
          value={tier}
        >
          <TabsList ariaLabel={facts.tiersLabel} className="flex w-full flex-wrap gap-1">
            <TabsTrigger className="flex-1 whitespace-nowrap" value="tier1">
              {`${facts.tier1.label} (${facts.tier1.count})`}
            </TabsTrigger>
            <TabsTrigger className="flex-1 whitespace-nowrap" value="tier2">
              {`${facts.tier2.label} (${facts.tier2.count})`}
            </TabsTrigger>
            <TabsTrigger className="flex-1 whitespace-nowrap" value="tier3">
              {`${facts.tier3.label} (${String(learnedFacts.length)})`}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tier === "tier1" ? (
        <div className="mt-4">
          <p className="max-w-2xl text-xs text-muted-foreground">{facts.tier1.note}</p>
          <div className="mt-3">
            {facts.tier1.rows.map((row) => {
              const factKey = keyForLabel(row.label);
              const resolvedValue = localEdits[factKey] ?? serverByKey.get(factKey) ?? row.value;

              return (
                <FactRow
                  action={row.action}
                  chip={chipForKind(row.chip)}
                  key={row.label}
                  kind={row.kind}
                  label={row.label}
                  note={row.note}
                  onSave={(nextValue) => {
                    persistFact(factKey, row.label, nextValue);
                  }}
                  saving={save.isPending}
                  value={resolvedValue}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
            <div className="rounded-xl border border-dashed border-border bg-background px-5 py-8 text-center">
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
              {learnedFacts.map((fact) => {
                const label = readableFactKey(fact.key);
                const resolvedValue = localEdits[fact.key] ?? fact.value;

                return (
                  <FactRow
                    action="edit"
                    chip={<SourceChip variant="dashed">{facts.typedHere}</SourceChip>}
                    key={fact.key}
                    label={label}
                    note="Reused on future applications"
                    onSave={(nextValue) => {
                      persistFact(fact.key, label, nextValue);
                    }}
                    saving={save.isPending}
                    value={resolvedValue}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
