import type { ReactNode } from "react";

import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "./backdrop.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { SignInStory } from "./signin-story.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function SignInLayout({ children }: { children: ReactNode }) {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <div className="signin-surface relative flex min-h-screen overflow-x-clip bg-background text-foreground min-[961px]:grid min-[961px]:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
      <Backdrop />
      <SignInStory />
      <main
        className="outline-none relative flex min-h-screen w-full flex-1 flex-col justify-between gap-5 px-[clamp(18px,4vw,52px)] pb-7 pt-[18px] min-[961px]:pb-8 min-[961px]:pt-7"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3">
          <Link
            className="-ml-2.5 inline-flex max-md:min-h-11 max-md:-my-[6px] items-center gap-[7px] rounded-md px-2.5 py-1.5 text-[13px] font-medium hover:bg-muted hover:text-foreground"
            to="/"
          >
            <NavGlyph name="back" size={15} />
            {copy.signIn.back}
          </Link>
          <button
            aria-label={label}
            aria-pressed={theme === "dark"}
            className="group flex items-center justify-center max-md:h-11 max-md:w-11 max-md:-m-[2px]"
            onClick={toggleTheme}
            type="button"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card group-hover:bg-muted">
              <NavGlyph name={theme === "dark" ? "sun" : "moon"} />
            </span>
          </button>
        </div>
        <div className="mx-auto my-auto flex w-full max-w-[418px] flex-col gap-[18px]">
          <div className="mb-[4px] flex flex-col items-center gap-2 text-center min-[961px]:mb-0 min-[961px]:hidden">
            <Link
              aria-label={copy.brand.homeAria}
              className="inline-flex max-md:min-h-11 max-md:-my-[5px] items-center gap-[10px] rounded-md hover:bg-muted"
              to="/"
            >
              <BrandMark size={34} />
              <span className="font-serif text-[30px] leading-none">{copy.app.name}</span>
            </Link>
            <p className="font-serif text-[17px] leading-[1.5] italic text-muted-foreground">
              {copy.signIn.brandTagline}
            </p>
          </div>
          {children}
<<<<<<< HEAD
          <footer className="flex flex-col items-center gap-1.5 text-center text-xs leading-[1.55] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] [line-height:normal]">
              <NavGlyph name="lock" size={12} />
              <span>{copy.signIn.trust}</span>
            </span>
            <p>
              {copy.signIn.legalIntro}{" "}
              <a
                className="decoration-input underline underline-offset-[3px] hover:text-foreground"
                href="/terms"
              >
                {copy.signIn.legalTerms}
              </a>{" "}
              {copy.signIn.legalJoin}{" "}
              <a
                className="decoration-input underline underline-offset-[3px] hover:text-foreground"
                href="/privacy"
              >
                {copy.signIn.legalPrivacy}
              </a>
              {copy.signIn.legalEnd}
            </p>
          </footer>
=======
>>>>>>> 4beed867 (Design parity (Sign In): match the canvas layout and refresh the signin snapshots)
        </div>
        <footer className="flex flex-col items-center gap-1.5 text-center text-xs leading-[1.55] text-muted-foreground">
          <p className="font-mono text-[11px] [line-height:normal]">
            <span aria-hidden="true" className="mr-1.5 inline-block align-[-2px]">
              <NavGlyph name="lock" size={12} />
            </span>
            {copy.signIn.trust}
          </p>
          <p>
            {copy.signIn.legalIntro}{" "}
            <a className="decoration-input underline underline-offset-[3px]" href="/terms">
              {copy.signIn.legalTerms}
            </a>{" "}
            {copy.signIn.legalJoin}{" "}
            <a className="decoration-input underline underline-offset-[3px]" href="/privacy">
              {copy.signIn.legalPrivacy}
            </a>
            {copy.signIn.legalEnd}
          </p>
        </footer>
      </main>
    </div>
  );
}
