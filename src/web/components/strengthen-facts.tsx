import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { StrengthenFact } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { ReviewAnswer } from "./review-answer.tsx";
import { fetchStrengthen, saveStrengthen } from "../lib/profile-api.ts";

function saveButtonLook() {
  return "inline-flex min-h-10 flex-none items-center justify-center gap-2 rounded-md border border-foreground bg-foreground px-4 text-[13.5px] leading-[normal] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:bg-btn-hover disabled:opacity-[.45] max-[767px]:min-h-12 max-[767px]:flex-[1_1_100%]";
}

export function StrengthenFacts() {
  const { strengthen } = copy.profile.facts;
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const strengthenQuery = useQuery({
    queryKey: ["profile-strengthen"],
    queryFn: fetchStrengthen,
  });

  const save = useMutation({
    mutationFn: async (fact: { key: string; value: string }) =>
      saveStrengthen(fact.key, fact.value),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["profile-strengthen"], saved);
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["home"] });
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
  });

  async function saveFact(fact: StrengthenFact) {
    const value = (drafts[fact.key] ?? "").trim();

    if (value === "" || pendingKey !== null) {
      return;
    }

    setPendingKey(fact.key);

    await save.mutateAsync({ key: fact.key, value }).catch(() => undefined);

    setPendingKey(null);
  }

  const facts = strengthenQuery.data?.facts ?? [];

  if (strengthenQuery.isPending) {
    return <p className="mt-3 text-[12.5px] text-muted-foreground">{strengthen.note}</p>;
  }

  if (facts.length === 0) {
    return (
      <p className="mt-4 max-w-[62ch] text-[12.5px] text-muted-foreground">{strengthen.empty}</p>
    );
  }

  return (
    <div className="mt-2">
      <p className="max-w-[62ch] text-[12.5px] text-muted-foreground">{strengthen.note}</p>
      {facts.map((fact) => {
        const labelId = `strengthen-${fact.key}-label`;
        const value = drafts[fact.key] ?? "";

        return (
          <div
            className="flex flex-wrap items-start gap-x-5 gap-y-3 border-t border-border py-4"
            data-testid={`strengthen-${fact.key}`}
            key={fact.key}
          >
            <div className="min-w-0 flex-[1_1_340px]">
              <p className="text-sm font-semibold leading-[1.4]" id={labelId}>
                {fact.label}
              </p>
              <p className="mt-0.5 max-w-[52ch] text-[13px] leading-[1.5] text-muted-foreground">
                {fact.prompt}
              </p>
              <div className="mt-2.5 max-w-[380px]">
                <ReviewAnswer
                  field={fact}
                  labelledBy={labelId}
                  onChange={(next) => {
                    setDrafts((current) => ({ ...current, [fact.key]: next }));
                  }}
                  value={value}
                />
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground tabular-nums">
                {strengthen.unlocks(fact.unlocked)}
              </p>
            </div>
            <button
              aria-label={strengthen.saveAria(fact.label)}
              className={saveButtonLook()}
              disabled={value.trim() === "" || pendingKey !== null}
              onClick={() => {
                void saveFact(fact);
              }}
              type="button"
            >
              {pendingKey === fact.key ? strengthen.saving : strengthen.save}
            </button>
          </div>
        );
      })}
    </div>
  );
}
