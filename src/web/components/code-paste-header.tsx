import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";

export function CodePasteHeader({ onClose, wait }: { onClose: () => void; wait: CodeWait }) {
  return (
    <div className="relative flex items-start gap-3 pr-11 md:pr-9">
      <div
        aria-hidden="true"
        className="serif flex h-[46px] w-[46px] flex-none items-center justify-center rounded-lg bg-foreground text-card-title italic text-background"
      >
        {wait.company.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5 font-medium text-muted-foreground">{wait.company}</p>
        <h2 className="serif mt-px text-card-title leading-[1.05]">{wait.title}</h2>
      </div>
      <button
        aria-label={copy.codePaste.close}
        className="absolute top-0 right-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground md:h-9 md:w-9"
        onClick={onClose}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
