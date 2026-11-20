import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Backdrop } from "../components/backdrop.tsx";
import { BrandMark } from "../components/brand-mark.tsx";
import { NavGlyph } from "../components/nav-glyph.tsx";
import { SignInCard } from "../components/signin-card.tsx";
import { SignInStory } from "../components/signin-story.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function SignInPage() {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <div className="relative flex min-h-[844px] flex-wrap bg-background text-foreground min-[961px]:min-h-screen">
      <Backdrop />
      <SignInStory />
      <main className="relative flex min-h-[844px] w-full flex-1 flex-col justify-between px-[clamp(18px,4vw,52px)] pb-7 pt-[18px] min-[961px]:pb-8 min-[961px]:pt-7">
        <div className="flex w-full items-center justify-between gap-3">
          <Link
            className="-ml-2.5 inline-flex items-center gap-[7px] rounded-md px-2.5 py-1.5 text-[13px] font-medium hover:bg-muted hover:text-foreground"
            to="/"
          >
            <NavGlyph name="back" size={15} />
            {copy.signIn.back}
          </Link>
          <button
            aria-label={label}
            aria-pressed={theme === "dark"}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted"
            onClick={toggleTheme}
            type="button"
          >
            <NavGlyph name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </div>
        <div className="flex w-full flex-col gap-[18px]">
          <div className="mb-[4px] flex flex-col items-center gap-2 text-center min-[961px]:mb-0 min-[961px]:hidden">
            <Link
              aria-label={copy.brand.homeAria}
              className="inline-flex items-center gap-[10px]"
              to="/"
            >
              <BrandMark size={34} />
              <span className="font-serif text-[30px] leading-none">{copy.app.name}</span>
            </Link>
            <p className="font-serif text-[17px] leading-[1.5] italic text-muted-foreground">
              {copy.signIn.brandTagline}
            </p>
          </div>
          <SignInCard />
          <footer className="flex flex-col items-center gap-1.5 text-center text-xs leading-[1.55] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] [line-height:normal]">
              <NavGlyph name="lock" size={12} />
              <span>{copy.signIn.trust}</span>
            </span>
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
        </div>
        <div aria-hidden="true" className="h-2" />
      </main>
    </div>
  );
}
