import { ArrowLeft, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { LandingGrain } from "./landing/landing-grain.tsx";
import { SignInStory } from "./signin-story.tsx";
import { Button } from "./ui/button.tsx";
import { useTheme } from "../lib/theme-context.ts";

export function SignInLayout({
  children,
  mode = "signin",
}: {
  children: ReactNode;
  mode?: "signin" | "signup";
}) {
  const { theme, toggleTheme, label } = useTheme();

  return (
    <div className="relative flex min-h-screen overflow-x-clip bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <LandingGrain variant="hero" />
      <SignInStory mode={mode} />
      <main
        className="relative z-10 flex min-h-screen w-full flex-1 flex-col justify-between gap-6 px-5 py-5 outline-none sm:px-8 lg:px-10 lg:py-7"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Button asChild className="-ml-2.5 px-2.5" size="default" variant="ghost">
            <Link to="/">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {copy.signIn.back}
            </Link>
          </Button>
          <Button
            ariaLabel={label}
            ariaPressed={theme === "dark"}
            onClick={toggleTheme}
            size="iconLg"
            variant="secondary"
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Moon aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mx-auto my-auto flex w-full max-w-md flex-col gap-5">{children}</div>
        <footer className="mx-auto flex w-full max-w-md flex-col items-center gap-1.5 text-center text-xs leading-relaxed text-muted-foreground">
          <p>
            {copy.signIn.legalIntro}{" "}
            <a
              className="underline decoration-input underline-offset-4 hover:text-foreground"
              href="/terms"
            >
              {copy.signIn.legalTerms}
            </a>{" "}
            {copy.signIn.legalJoin}{" "}
            <a
              className="underline decoration-input underline-offset-4 hover:text-foreground"
              href="/privacy"
            >
              {copy.signIn.legalPrivacy}
            </a>
            {copy.signIn.legalEnd}
          </p>
        </footer>
      </main>
    </div>
  );
}
