import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { SkipCompany } from "../lib/profile-api.ts";
import { OnboardingBlockedEmployers } from "./onboarding-blocked-employers.tsx";
import { Badge } from "./ui/badge.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

export function OnboardingTargetsOptional({
  currentEmployer,
  onCommitSalary,
  onSalaryChange,
  onSaveCurrentEmployer,
  onSaveSkip,
  salary,
  skipCompanies,
}: {
  currentEmployer: string | null;
  onCommitSalary: (raw: string) => void;
  onSalaryChange: (raw: string) => void;
  onSaveCurrentEmployer: (name: string) => Promise<void> | void;
  onSaveSkip: (companies: { name: string; domain: string | null }[]) => Promise<{
    companies: SkipCompany[];
  }>;
  salary: string;
  skipCompanies: SkipCompany[];
}) {
  const [open, setOpen] = useState(false);

  const savedCount =
    (salary.trim() === "" ? 0 : 1) + (currentEmployer === null ? 0 : 1) + skipCompanies.length;

  return (
    <div className="border-t border-border pt-5">
      <button
        aria-expanded={open}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {copy.onboarding.optionalToggle}
          </span>
          {savedCount > 0 ? (
            <Badge variant="outline">{copy.onboarding.optionalSavedBadge(savedCount)}</Badge>
          ) : null}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`shrink-0 text-muted-foreground transition-transform duration-quick ${
            open ? "rotate-180" : ""
          }`}
          size={16}
        />
      </button>

      {open ? (
        <div className="mt-4 space-y-5 rounded-lg border border-border bg-muted/20 p-4">
          <div>
            <label className={`${dsEyebrow} mb-2 block`} htmlFor="w-sal">
              {copy.onboarding.salaryFloor}
            </label>
            <div className="flex max-w-xs items-center gap-2.5">
              <Input
                className="tabular-nums"
                id="w-sal"
                inputMode="numeric"
                onBlur={(event) => {
                  onCommitSalary(event.currentTarget.value);
                }}
                onChange={(event) => {
                  onSalaryChange(event.currentTarget.value);
                }}
                value={salary}
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {copy.onboarding.salaryFloorUnit}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {copy.onboarding.salaryFloorNote}
            </p>
          </div>

          <OnboardingBlockedEmployers
            currentEmployer={currentEmployer}
            onSaveCurrentEmployer={onSaveCurrentEmployer}
            onSaveSkip={onSaveSkip}
            skipCompanies={skipCompanies}
          />
        </div>
      ) : null}
    </div>
  );
}
