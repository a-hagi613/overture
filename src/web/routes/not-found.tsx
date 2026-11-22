import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { NotFoundFooter } from "../components/not-found-footer.tsx";
import { NotFoundHeader } from "../components/not-found-header.tsx";

const text = copy.notFound;

/**
 * The public 404 screen at any unknown path, drawn to the `w5-404` canvas board.
 * @returns The 404 page.
 */
export function NotFoundPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <Backdrop />
      <div className="relative z-[1] flex min-h-dvh flex-col">
        <NotFoundHeader />
        <main
          className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center px-[clamp(20px,4vw,48px)] pb-[clamp(72px,10vw,150px)] pt-[clamp(56px,9vw,124px)] text-center outline-none min-[1700px]:max-w-[1440px]"
          id="main-content"
          tabIndex={-1}
        >
          <p
            aria-hidden="true"
            className="font-serif text-[clamp(120px,22vw,260px)] leading-[0.8] italic text-[color:var(--color-input)]"
          >
            {text.code}
          </p>
          <h1 className="mt-[30px] font-serif text-[clamp(42px,6vw,72px)] leading-none tracking-[-0.02em]">
            {text.titlePlain} <span className="italic">{text.titleItalic}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-[34ch] text-[17px] leading-[1.6] text-muted-foreground">
            {text.body}
          </p>
          <div className="mt-[34px] flex flex-wrap items-center justify-center gap-x-[26px] gap-y-3.5">
            <Link
              className="inline-flex min-h-[46px] items-center justify-center rounded-md border border-foreground bg-foreground px-6 text-[14px] font-semibold text-background hover:bg-btn-hover"
              to="/"
            >
              {text.home}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center border-b border-input px-0 text-[14px] font-medium text-muted-foreground hover:text-foreground"
              to="/board"
            >
              {text.board}
            </Link>
          </div>
        </main>
        <NotFoundFooter />
      </div>
    </div>
  );
}
