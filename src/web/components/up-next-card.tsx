import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { UpNextPosting } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";
import { applyToPosting, openPosting, savePosting } from "../lib/home-api.ts";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const ghostButton =
  "inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground hover:border-input hover:bg-muted";

const primaryButton =
  "inline-flex min-h-9 items-center rounded-md border border-foreground bg-foreground px-3 text-[12.5px] font-semibold text-primary-ink hover:bg-btn-hover";

function workplaceLabel(posting: UpNextPosting) {
  const labels = copy.home.upNext.workplace;

  if (posting.workplace === "remote") {
    return labels.remote;
  }

  if (posting.workplace === "hybrid") {
    return labels.hybrid;
  }

  if (posting.workplace === "onsite") {
    return labels.onsite;
  }

  return labels.unknown;
}

function salaryLine(posting: UpNextPosting) {
  if (posting.salaryMinMinor === null || posting.salaryCurrency === null) {
    return copy.home.upNext.salaryNotListed;
  }

  return `${posting.salaryCurrency} ${money.format(posting.salaryMinMinor / 100)}`;
}

function metaLine(posting: UpNextPosting) {
  const parts = [
    posting.location ?? workplaceLabel(posting),
    workplaceLabel(posting),
    salaryLine(posting),
  ];

  return parts.join(" · ");
}

export function UpNextCard(props: { posting: UpNextPosting }) {
  const queryClient = useQueryClient();
  const { posting } = props;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["home"] });
  }

  const score = useMutation({
    mutationFn: async () => openPosting(posting.id),
    onSuccess: refresh,
  });

  const apply = useMutation({
    mutationFn: async () => applyToPosting(posting.id),
    onSuccess: refresh,
  });

  const save = useMutation({
    mutationFn: async () => savePosting(posting.id, posting.saved ? null : "saved"),
    onSuccess: refresh,
  });

  const hide = useMutation({
    mutationFn: async () => savePosting(posting.id, "hidden"),
    onSuccess: refresh,
  });

  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-md bg-foreground font-serif text-[18px] italic text-primary-ink"
        >
          {posting.company.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {posting.company}
          </p>
          <button
            className="mt-0.5 block text-left font-serif text-[19px] leading-[1.2] hover:underline"
            onClick={() => {
              score.mutate();
            }}
            type="button"
          >
            {posting.title}
          </button>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{metaLine(posting)}</p>
          {posting.score === null ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {copy.home.upNext.scoreOnOpenNote}
            </p>
          ) : (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold tabular-nums">
                {copy.home.upNext.scoreAria(posting.score)}
              </span>
              {posting.strong ? (
                <span className="rounded-full bg-signal/10 px-2 py-0.5 text-[11px] font-semibold text-signal-text">
                  {copy.home.upNext.strong}
                </span>
              ) : null}
              <span className="text-muted-foreground">{posting.reason}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              aria-label={copy.home.upNext.applyAria(posting.title)}
              className={primaryButton}
              disabled={apply.isPending}
              onClick={() => {
                apply.mutate();
              }}
              type="button"
            >
              {apply.isSuccess ? copy.home.upNext.applied : copy.home.upNext.apply}
            </button>
            <button
              aria-label={
                posting.saved
                  ? copy.home.upNext.unsaveAria(posting.title)
                  : copy.home.upNext.saveAria(posting.title)
              }
              aria-pressed={posting.saved}
              className={ghostButton}
              disabled={save.isPending}
              onClick={() => {
                save.mutate();
              }}
              type="button"
            >
              {posting.saved ? copy.home.upNext.saved : copy.home.upNext.save}
            </button>
            <button
              aria-label={copy.home.upNext.hideAria(posting.title)}
              className={ghostButton}
              disabled={hide.isPending}
              onClick={() => {
                hide.mutate();
              }}
              type="button"
            >
              {copy.home.upNext.hide}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
