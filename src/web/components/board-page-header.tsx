import { copy } from "../../shared/copy.ts";
import { ThemeToggle } from "./theme-toggle.tsx";

type Filter = "all" | "needs" | "checking";

export function BoardPageHeader(props: {
  filterOpen: boolean;
  onFilter: (filter: Filter) => void;
  onToggleFilter: () => void;
  onToggleRunning: () => void;
  running: boolean;
  total: number;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3.5 pr-8">
      <div>
        <p className="serif text-[15px] text-muted-foreground italic">
          {copy.board.lead(props.total)}
        </p>
        <h1 className="serif mt-0.5 text-[42px] leading-[1.05]">
          {copy.board.titlePlain} <span className="italic">{copy.board.titleItalic}</span>
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ThemeToggle className="ibtn tgl" />
        <label className="field">
          <svg
            aria-hidden="true"
            className="text-muted-foreground"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="16"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            aria-label={copy.board.searchLabel}
            placeholder={copy.board.searchLabel}
            type="search"
          />
        </label>
        <div className="relative">
          <button
            aria-expanded={props.filterOpen}
            aria-haspopup="menu"
            className="btn2"
            onClick={props.onToggleFilter}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {copy.board.filter}
          </button>
          {props.filterOpen ? (
            <div
              className="absolute top-full right-0 z-10 mt-1 min-w-[180px] rounded-md border border-input bg-card p-1 shadow-lift"
              role="menu"
            >
              {(
                [
                  ["all", copy.review.all],
                  ["needs", copy.board.states.needsYou],
                  ["checking", copy.board.states.checking],
                ] as const
              ).map(([key, label]) => (
                <button
                  className="flex w-full items-center rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  key={key}
                  onClick={() => {
                    props.onFilter(key);
                  }}
                  role="menuitem"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex h-10 items-center gap-2.5 rounded-md border border-input bg-card pr-1.5 pl-[13px]">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <span className="h-2 w-2 rounded-full bg-signal" />
            {props.running ? copy.board.running : copy.board.paused}
          </span>
          <button
            className="btn2 min-h-[30px] bg-muted px-3 text-[12.5px]"
            onClick={props.onToggleRunning}
            type="button"
          >
            {props.running ? copy.board.pause : copy.board.start}
          </button>
        </div>
      </div>
    </header>
  );
}
