import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { ChoiceChip } from "./choice-chip.tsx";
import { Section } from "./section.tsx";
import { SectionHead } from "./section-head.tsx";
import { SourceChip } from "./source-chip.tsx";
import { fetchSkipCompanies, saveSkipCompanies } from "../lib/profile-api.ts";

export function SkipSection() {
  const list = copy.profile.skipList;
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState("");

  const companiesQuery = useQuery({
    queryKey: ["profile-skip-companies"],
    queryFn: fetchSkipCompanies,
  });

  const save = useMutation({
    mutationFn: saveSkipCompanies,
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-skip-companies"], saved);
    },
  });

  const companies = companiesQuery.data?.companies ?? [];
  const currentEmployer = companies.find((company) => company.reason === "current_employer");
  const userCompanies = companies.filter((company) => company.reason === "user");

  function persist(names: string[]) {
    save.mutate(names.map((name) => ({ name, domain: null })));
  }

  function addCompany() {
    const name = companyName.trim();

    if (name === "") {
      return;
    }

    persist([...userCompanies.map((company) => company.name), name]);

    setCompanyName("");
  }

  return (
    <Section id="profile-skip" labelledBy="profile-skip-heading">
      <SectionHead
        headingId="profile-skip-heading"
        intro={list.intro}
        title={
          <>
            {list.titlePlain} <span className="italic">{list.titleItalic}</span>
          </>
        }
      />
      <div className="mt-5 flex flex-wrap gap-2">
        {currentEmployer === undefined ? null : (
          <span className="inline-flex min-h-9 items-center gap-0.5 rounded-full border border-input bg-card px-[13px] text-[13px] font-semibold max-[767px]:min-h-11">
            {currentEmployer.name}
            <span className="ml-2">
              <SourceChip variant="dashed">{list.currentEmployer}</SourceChip>
            </span>
          </span>
        )}
        {userCompanies.map((company) => (
          <ChoiceChip
            key={company.id}
            onRemove={() => {
              persist(
                userCompanies
                  .filter((candidate) => candidate.id !== company.id)
                  .map((candidate) => candidate.name),
              );
            }}
            removeLabel={copy.profile.facts.remove(company.name)}
          >
            {company.name}
          </ChoiceChip>
        ))}
      </div>
      <form
        className="mt-[18px] flex flex-wrap items-center gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          addCompany();
        }}
      >
        <label className="flex h-10 min-w-0 max-w-[380px] flex-[1_1_260px] items-center rounded-md border border-input bg-card px-3 max-[767px]:h-11 max-[767px]:max-w-full">
          <input
            aria-label={list.addLabel}
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] font-medium text-foreground outline-0 placeholder:text-muted-foreground leading-[normal]"
            onChange={(event) => setCompanyName(event.currentTarget.value)}
            placeholder={list.addLabel}
            type="text"
            value={companyName}
          />
        </label>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-[13.5px] leading-[normal] font-semibold hover:bg-muted max-[767px]:min-h-11"
          type="submit"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {list.add}
        </button>
      </form>
      <p className="mt-3 max-w-[62ch] text-[12.5px] text-muted-foreground">{list.note}</p>
    </Section>
  );
}
