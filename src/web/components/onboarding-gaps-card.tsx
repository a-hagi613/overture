import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type { KeyDetailFactKey } from "../../shared/key-details.ts";
import type { KeyDetailField } from "../lib/onboarding-api.ts";

import { copy } from "../../shared/copy.ts";
import {
  KEY_DETAIL_FACT_LABELS,
  KEY_DETAIL_ROWS,
  yesNoFromStatement,
} from "../../shared/key-details.ts";
import { OnboardingGapsField } from "./onboarding-gaps-field.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

const gapsText = copy.onboarding.gaps;

const yesNoKeys = new Set<KeyDetailFactKey>(
  KEY_DETAIL_ROWS.filter((row) => row.control === "yes-no").flatMap((row) => row.keys),
);

function initialValues(fields: readonly KeyDetailField[]) {
  const values: Record<string, string> = {};

  for (const field of fields) {
    values[field.key] = yesNoKeys.has(field.key) ? yesNoFromStatement(field.value) : field.value;
  }

  return values;
}

function sourcesByKey(fields: readonly KeyDetailField[]) {
  return new Map(fields.map((field) => [field.key, field.source] as const));
}

export function OnboardingGapsCard({
  backTo,
  fields,
  onContinue,
  onSave,
  preview,
}: {
  backTo: string;
  fields: readonly KeyDetailField[];
  onContinue: () => Promise<void>;
  onSave: (fields: { key: string; value: string }[]) => Promise<void>;
  preview: boolean;
}) {
  const [values, setValues] = useState(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const sources = sourcesByKey(fields);

  const change = (key: KeyDetailFactKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([errorKey]) => errorKey !== key)),
    );
  };

  const submit = async () => {
    if (submitting) {
      return;
    }

    const nextErrors: Record<string, string> = {};

    for (const row of KEY_DETAIL_ROWS) {
      if (!row.required) {
        continue;
      }

      for (const key of row.keys) {
        if ((values[key] ?? "").trim() === "") {
          nextErrors[key] = gapsText.required(KEY_DETAIL_FACT_LABELS[key]);
        }
      }
    }

    const [firstInvalid] = Object.keys(nextErrors);

    if (firstInvalid !== undefined) {
      setErrors(nextErrors);
      document.querySelector<HTMLElement>(`#gaps-${firstInvalid}`)?.focus();

      return;
    }

    setSubmitting(true);
    setFailed(false);

    try {
      if (!preview) {
        await onSave(
          KEY_DETAIL_ROWS.flatMap((row) =>
            row.keys.map((key) => ({ key, value: (values[key] ?? "").trim() })),
          ),
        );
      }

      await onContinue();
    } catch {
      setFailed(true);
      setSubmitting(false);
    }
  };

  return (
    <Card ariaLabelledBy="gaps-h" className="p-6 md:p-7" id="onboarding-gaps">
      <h2 className={dsCardTitle} id="gaps-h">
        {gapsText.titlePlain}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{gapsText.intro}</p>
      <p className="mt-1 text-xs text-muted-foreground">{gapsText.readNote}</p>

      <form
        className="mt-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-6">
          {KEY_DETAIL_ROWS.map((row) => (
            <div className="border-t border-border pt-6 first:border-t-0 first:pt-0" key={row.id}>
              {row.keys.length === 1 ? null : (
                <p className="mb-3 text-sm font-semibold text-foreground">{row.label}</p>
              )}
              <div
                className={
                  row.keys.length === 1 ? "" : "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5"
                }
              >
                {row.keys.map((key) => (
                  <OnboardingGapsField
                    control={row.control}
                    error={errors[key]}
                    fieldKey={key}
                    key={key}
                    onChange={(value) => {
                      change(key, value);
                    }}
                    optional={!row.required}
                    source={sources.get(key) ?? null}
                    value={values[key] ?? ""}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {failed ? (
          <p className="mt-6 text-xs font-semibold text-need" role="alert">
            {gapsText.saveFailed}
          </p>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button asChild size="default" variant="ghost">
            <Link to={backTo}>
              <ArrowLeft aria-hidden="true" size={15} />
              <span>{gapsText.back}</span>
            </Link>
          </Button>
          <Button ariaBusy={submitting} disabled={submitting} size="lg" submit variant="primary">
            <span>{gapsText.continue}</span>
            <ArrowRight aria-hidden="true" size={16} />
          </Button>
        </div>
      </form>
    </Card>
  );
}
