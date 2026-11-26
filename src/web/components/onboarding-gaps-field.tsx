import type { KeyDetailFactKey, KeyDetailRow } from "../../shared/key-details.ts";
import type { KeyDetailField } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import { KEY_DETAIL_FACT_LABELS } from "../../shared/key-details.ts";
import { SourceChip } from "./source-chip.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";
import { Select } from "./ui/select.tsx";

const gapsText = copy.onboarding.gaps;

const autoCompleteByKey: Partial<Record<KeyDetailFactKey, string>> = {
  current_city: "address-level2",
  current_country: "country-name",
  current_employer: "organization",
  email: "email",
  legal_name: "name",
  linkedin_url: "url",
  phone: "tel",
};

function inputType(control: KeyDetailRow["control"]) {
  if (control === "email" || control === "tel" || control === "url") {
    return control;
  }

  return "text";
}

export function OnboardingGapsField({
  control,
  error,
  fieldKey,
  onChange,
  optional,
  source,
  value,
}: {
  control: KeyDetailRow["control"];
  error: string | undefined;
  fieldKey: KeyDetailFactKey;
  onChange: (value: string) => void;
  optional: boolean;
  source: KeyDetailField["source"];
  value: string;
}) {
  const id = `gaps-${fieldKey}`;
  const errorId = `${id}-error`;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <label className={`${dsEyebrow} block`} htmlFor={id}>
          {KEY_DETAIL_FACT_LABELS[fieldKey]}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {optional ? (
            <span className="text-xs text-muted-foreground">{gapsText.optional}</span>
          ) : null}
          {source === null || value.trim() === "" ? null : (
            <SourceChip variant={source === "resume" ? "solid" : "dashed"}>
              {source === "resume" ? gapsText.sourceResume : gapsText.sourceSaved}
            </SourceChip>
          )}
        </div>
      </div>

      {control === "yes-no" ? (
        <Select
          ariaDescribedBy={error === undefined ? undefined : errorId}
          id={id}
          invalid={error !== undefined}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          selectClassName="h-12"
          value={value}
        >
          <option value="">{gapsText.choose}</option>
          <option value="Yes">{gapsText.yes}</option>
          <option value="No">{gapsText.no}</option>
        </Select>
      ) : (
        <Input
          ariaDescribedBy={error === undefined ? undefined : errorId}
          autoComplete={autoCompleteByKey[fieldKey] ?? "off"}
          id={id}
          invalid={error !== undefined}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          type={inputType(control)}
          value={value}
        />
      )}

      {error === undefined ? null : (
        <p className="mt-1.5 text-xs font-semibold text-need" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
