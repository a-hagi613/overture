import { copy } from "../../../shared/copy.ts";
import type { LlmUsageModelRow, LlmUsagePurposeRow } from "../../lib/admin-api.ts";
import { LlmModelRow } from "./llm-model-row.tsx";
import { LlmPurposeRow } from "./llm-purpose-row.tsx";

export function LlmBreakdowns({
  activePurpose,
  byModel,
  byPurpose,
  expectedModel,
  onSelectPurpose,
}: {
  activePurpose: string;
  byModel: LlmUsageModelRow[];
  byPurpose: LlmUsagePurposeRow[];
  expectedModel: string;
  onSelectPurpose: (purpose: string) => void;
}) {
  const unexpectedModels = byModel.flatMap((row) => (row.unexpected ? [row.model] : []));

  return (
    <>
      {unexpectedModels.length > 0 ? (
        <section
          aria-labelledby="admin-llm-unexpected-heading"
          className="mt-5 rounded-lg border border-need bg-need-soft px-5 py-4"
        >
          <h2
            className="font-serif text-[20px] leading-[1.2] text-need"
            id="admin-llm-unexpected-heading"
          >
            {copy.admin.llmUnexpectedHeading}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground">
            {copy.admin.llmUnexpectedBody(expectedModel, unexpectedModels.join(", "))}
          </p>
        </section>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section
          aria-labelledby="admin-llm-by-purpose"
          className="rounded-lg border border-border bg-card p-[20px_22px] shadow-sh"
        >
          <h2 className="font-serif text-[24px] leading-[1.1]" id="admin-llm-by-purpose">
            {copy.admin.llmByPurposeHeading}
          </h2>
          {byPurpose.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">{copy.admin.llmByPurposeEmpty}</p>
          ) : (
            <ul className="mt-3 list-none p-0">
              {byPurpose.map((row) => (
                <LlmPurposeRow
                  activePurpose={activePurpose}
                  key={row.purpose}
                  onSelectPurpose={onSelectPurpose}
                  row={row}
                />
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="admin-llm-by-model"
          className="rounded-lg border border-border bg-card p-[20px_22px] shadow-sh"
        >
          <h2 className="font-serif text-[24px] leading-[1.1]" id="admin-llm-by-model">
            {copy.admin.llmByModelHeading}
          </h2>
          {byModel.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">{copy.admin.llmByModelEmpty}</p>
          ) : (
            <ul className="mt-3 list-none p-0">
              {byModel.map((row) => (
                <LlmModelRow key={row.model} row={row} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
