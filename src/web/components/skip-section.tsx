import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { fetchSkipCompanies, saveSkipCompanies } from "../lib/profile-api.ts";
import { SourceChip } from "./source-chip.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

export function SkipSection() {
  const list = copy.profile.skipList;
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState("");

  const companiesQuery = useQuery({
    queryFn: fetchSkipCompanies,
    queryKey: ["profile-skip-companies"],
  });

  const save = useMutation({
    mutationFn: saveSkipCompanies,
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-skip-companies"], saved);
      toast.success(copy.profileWorkspace.skipListSavedToast);
    },
  });

  const companies = companiesQuery.data?.companies ?? [];
  const currentEmployer = companies.find((company) => company.reason === "current_employer");
  const userCompanies = companies.filter((company) => company.reason === "user");

  function persist(names: string[], onSucceeded?: () => void) {
    save.mutate(
      names.map((name) => ({ domain: null, name })),
      {
        onError: () => {
          toast.error(copy.profile.saveFailed);
        },
        onSuccess: () => {
          onSucceeded?.();
        },
      },
    );
  }

  function addCompany() {
    const name = companyName.trim();

    if (name === "" || save.isPending) {
      return;
    }

    persist([...userCompanies.map((company) => company.name), name], () => {
      setCompanyName("");
    });
  }

  return (
    <Card ariaLabelledBy="profile-skip-heading" className="p-5 md:p-6" id="profile-skip">
      <h2 className={dsCardTitle} id="profile-skip-heading">
        {`${list.titlePlain} ${list.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{list.intro}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {currentEmployer === undefined ? null : (
          <Badge className="gap-2 py-1 pl-3 pr-2" variant="outline">
            <span>{currentEmployer.name}</span>
            <SourceChip variant="dashed">{list.currentEmployer}</SourceChip>
          </Badge>
        )}
        {userCompanies.map((company) => (
          <Button
            ariaLabel={copy.profile.facts.remove(company.name)}
            className="rounded-full"
            disabled={save.isPending}
            key={company.id}
            onClick={() => {
              persist(
                userCompanies
                  .filter((candidate) => candidate.id !== company.id)
                  .map((candidate) => candidate.name),
              );
            }}
            size="sm"
            variant="secondary"
          >
            <span>{company.name}</span>
            <X aria-hidden="true" size={13} />
          </Button>
        ))}
        {currentEmployer === undefined && userCompanies.length === 0 ? (
          <p className="text-xs text-muted-foreground">{copy.profileWorkspace.skipListEmpty}</p>
        ) : null}
      </div>

      <form
        className="mt-5 flex flex-wrap items-center gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          addCompany();
        }}
      >
        <Input
          ariaLabel={list.addLabel}
          className="h-10 min-w-44 flex-1"
          onChange={(event) => {
            setCompanyName(event.currentTarget.value);
          }}
          placeholder={list.addLabel}
          value={companyName}
        />
        <Button disabled={save.isPending} size="default" submit variant="secondary">
          <Plus aria-hidden="true" size={15} />
          <span>{list.add}</span>
        </Button>
      </form>

      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">{list.note}</p>
    </Card>
  );
}
