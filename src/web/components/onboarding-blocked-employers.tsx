import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { SkipCompany } from "../lib/profile-api.ts";

import { copy } from "../../shared/copy.ts";
import { SourceChip } from "./source-chip.tsx";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

export function OnboardingBlockedEmployers({
  currentEmployer,
  onSaveCurrentEmployer,
  onSaveSkip,
  skipCompanies,
}: {
  currentEmployer: string | null;
  onSaveCurrentEmployer: (name: string) => Promise<void> | void;
  onSaveSkip: (companies: { name: string; domain: string | null }[]) => Promise<{
    companies: SkipCompany[];
  }>;
  skipCompanies: SkipCompany[];
}) {
  const [employer, setEmployer] = useState(currentEmployer ?? "");
  const [companies, setCompanies] = useState(skipCompanies);
  const [newCompany, setNewCompany] = useState("");
  const userCompanies = companies.filter((company) => company.reason === "user");

  async function persist(names: string[]) {
    try {
      const saved = await onSaveSkip(names.map((name) => ({ domain: null, name })));

      setCompanies(saved.companies);
    } catch {
      setCompanies(skipCompanies);
    }
  }

  function addCompany() {
    const name = newCompany.trim();

    if (name === "") {
      return;
    }

    void persist([...userCompanies.map((company) => company.name), name]);
    setNewCompany("");
  }

  return (
    <>
      <div>
        <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-employer">
          {copy.onboarding.currentEmployer}
        </label>
        <form
          className="flex max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = employer.trim();

            if (name !== "") {
              void onSaveCurrentEmployer(name);
            }
          }}
        >
          <Input
            ariaLabel={copy.onboarding.currentEmployer}
            id="w-employer"
            onChange={(event) => {
              setEmployer(event.currentTarget.value);
            }}
            placeholder={copy.onboarding.currentEmployerPlaceholder}
            value={employer}
          />
          <Button size="default" submit variant="secondary">
            <span>{copy.onboarding.add}</span>
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {currentEmployer === null
            ? copy.onboarding.currentEmployerHint
            : copy.onboarding.currentEmployerSaved(currentEmployer)}
        </p>
      </div>

      <div>
        <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-skip">
          {copy.onboarding.companiesToSkip}
        </label>
        {companies.length === 0 ? null : (
          <div className="mb-3 flex flex-wrap gap-2">
            {currentEmployer === null ? null : (
              <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-muted px-3.5 text-xs font-semibold text-foreground">
                <span>{currentEmployer}</span>
                <SourceChip variant="dashed">{copy.profile.skipList.currentEmployer}</SourceChip>
              </span>
            )}
            {userCompanies.map((company) => (
              <Button
                ariaLabel={copy.profile.facts.remove(company.name)}
                className="rounded-full"
                key={company.id}
                onClick={() => {
                  void persist(
                    userCompanies
                      .filter((candidate) => candidate.id !== company.id)
                      .map((candidate) => candidate.name),
                  );
                }}
                size="sm"
                variant="outline"
              >
                <span>{company.name}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            ))}
          </div>
        )}
        <form
          className="flex max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addCompany();
          }}
        >
          <Input
            ariaLabel={copy.onboarding.addCompanyPlaceholder}
            id="w-skip"
            onChange={(event) => {
              setNewCompany(event.currentTarget.value);
            }}
            placeholder={copy.onboarding.addCompanyPlaceholder}
            value={newCompany}
          />
          <Button size="default" submit variant="secondary">
            <Plus aria-hidden="true" size={14} />
            <span>{copy.onboarding.add}</span>
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {copy.onboarding.companiesToSkipNote}
        </p>
      </div>
    </>
  );
}
