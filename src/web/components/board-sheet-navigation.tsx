import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";

export function BoardSheetNavigation(props: {
  detail: ApplicationDetail | null;
  nextDisabled: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  previousDisabled: boolean;
}) {
  return (
    <div className="hidden items-center justify-between border-b border-border px-[22px] pt-4 pr-[22px] pb-3.5 pl-[26px] md:flex">
      <span className="eyebrow">
        {copy.board.reference(props.detail?.application.id.slice(-4) ?? "")}
      </span>
      <span className="flex gap-1.5">
        <button
          aria-label={copy.board.previousCard}
          className="ibtn !h-9 !w-9 border-0 bg-transparent"
          disabled={props.previousDisabled}
          onClick={props.onPrevious}
          type="button"
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
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
        <button
          aria-label={copy.board.nextCard}
          className="ibtn !h-9 !w-9 border-0 bg-transparent"
          disabled={props.nextDisabled}
          onClick={props.onNext}
          type="button"
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
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button
          aria-label={copy.board.closeDetail}
          className="ibtn !h-9 !w-9 border-0 bg-transparent"
          onClick={props.onClose}
          type="button"
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
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </span>
    </div>
  );
}
