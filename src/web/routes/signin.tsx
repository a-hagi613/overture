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
    <div className="relative flex min-h-screen flex-wrap bg-background text-foreground">
      <Backdrop />
      <SignInStory />
      <main className="relative flex min-h-[844px] w-full flex-1 flex-col justify-between gap-5 px-[max(18px,4vw)] pb-7 pt-[18px] min-[961px]:py-7">
        <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3">
          <Link
            className="-ml-2.5 inline-flex items-center gap-[7px] rounded-md p-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
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
        <div className="mx-auto flex w-full max-w-[418px] flex-col gap-[18px]">
          <div className="mb-1 flex flex-col items-center gap-2 text-center min-[961px]:hidden">
            <BrandMark size={34} />
            <span className="font-serif text-[30px] leading-none">{copy.app.name}</span>
            <span className="font-serif text-[17px] italic text-muted-foreground">
              {copy.signIn.brandTagline}
            </span>
          </div>
          <SignInCard />
          <footer className="flex flex-col items-center gap-1.5 text-center text-xs leading-[1.55] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
              <NavGlyph name="lock" size={12} />
              {copy.signIn.trust}
            </span>
            <p>{copy.signIn.legal}</p>
          </footer>
        </div>
        <div aria-hidden="true" className="h-2" />
      </main>
    </div>
  );
}
