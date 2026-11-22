import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function BoardPageHeader(props: {
  onToggleRunning: () => void;
  running: boolean;
  total: number;
}) {
  const navigate = useNavigate();

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
        <Link
          aria-label={copy.nav.calendar}
          className="ibtn"
          title={copy.nav.calendar}
          to="/calendar"
        >
          <NavGlyph name="calendar" />
        </Link>
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
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }

              const value = event.currentTarget.value.trim();

              if (value !== "") {
                void navigate(`/search?q=${encodeURIComponent(value)}`);
              }
            }}
            placeholder={copy.board.searchLabel}
            type="search"
          />
        </label>
        <div className="flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md border border-input bg-card pr-1.5 pl-[13px]">
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
