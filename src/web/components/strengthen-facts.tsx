import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { StrengthenFact } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { fetchStrengthen, saveStrengthen } from "../lib/profile-api.ts";
import { ReviewAnswer } from "./review-answer.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

export function StrengthenFacts() {
  const { strengthen } = copy.profile.facts;
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const strengthenQuery = useQuery({
    queryFn: fetchStrengthen,
    queryKey: ["profile-strengthen"],
  });

  const save = useMutation({
    mutationFn: async (fact: { key: string; value: string }) =>
      saveStrengthen(fact.key, fact.value),
    onSuccess: async (saved, variables) => {
      queryClient.setQueryData(["profile-strengthen"], saved);
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([entryKey]) => entryKey !== variables.key),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["home"] }),
        queryClient.invalidateQueries({ queryKey: ["reviews"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-facts"] }),
        queryClient.invalidateQueries({ queryKey: ["ready"] }),
        queryClient.invalidateQueries({ queryKey: ["nav"] }),
      ]);
    },
  });

  async function saveFact(fact: StrengthenFact) {
    const value = (drafts[fact.key] ?? "").trim();

    if (value === "" || pendingKey !== null) {
      return;
    }

    setPendingKey(fact.key);

    try {
      await save.mutateAsync({ key: fact.key, value });
      toast.success(copy.profileWorkspace.factSavedToast(fact.label));
    } catch {
      toast.error(copy.profile.saveFailed);
    }

    setPendingKey(null);
  }

  const facts = strengthenQuery.data?.facts ?? [];

  if (strengthenQuery.isPending) {
    return <p className="mt-4 text-sm text-muted-foreground">{strengthen.note}</p>;
  }

  if (facts.length === 0) {
    return <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{strengthen.empty}</p>;
  }

  return (
    <div className="mt-4">
      <p className="max-w-2xl text-xs text-muted-foreground">{strengthen.note}</p>
      <div className="mt-3 divide-y divide-border">
        {facts.map((fact) => {
          const labelId = `strengthen-${fact.key}-label`;
          const value = drafts[fact.key] ?? "";

          return (
            <div
              className="flex flex-wrap items-start justify-between gap-4 py-4"
              data-testid={`strengthen-${fact.key}`}
              key={fact.key}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground" id={labelId}>
                  {fact.label}
                </p>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{fact.prompt}</p>
                <div className="mt-3 max-w-md">
                  <ReviewAnswer
                    field={fact}
                    labelledBy={labelId}
                    onChange={(next) => {
                      setDrafts((current) => ({ ...current, [fact.key]: next }));
                    }}
                    value={value}
                  />
                </div>
                <Badge className="mt-2.5" variant="signal">
                  {strengthen.unlocks(fact.unlocked)}
                </Badge>
              </div>
              <Button
                ariaLabel={strengthen.saveAria(fact.label)}
                disabled={value.trim() === "" || pendingKey !== null}
                onClick={() => {
                  void saveFact(fact);
                }}
                size="sm"
                variant="primary"
              >
                <Check aria-hidden="true" size={14} />
                <span>{pendingKey === fact.key ? strengthen.saving : strengthen.save}</span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
