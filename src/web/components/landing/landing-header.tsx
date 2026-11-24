import { Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "../../lib/theme-context.ts";
import { BrandMark } from "../brand-mark.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { dsContainer, dsNavLink } from "../ui/ds.ts";
import { LANDING_COPY } from "./landing-copy.ts";

const NAV_LINKS = [
  { href: "#how-it-works", label: LANDING_COPY.nav.howItWorks },
  { href: "#live-jobs", label: LANDING_COPY.nav.liveJobs },
  { href: "#pricing", label: LANDING_COPY.nav.pricing },
  { href: "#faq", label: LANDING_COPY.nav.faq },
] as const;

export function LandingHeader() {
  const { label, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const toggleMenu = () => {
    setMenuOpen((current) => !current);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  useEffect(() => {
    const updateScrolled = () => {
      setScrolled(globalThis.scrollY > 8);
    };

    updateScrolled();
    globalThis.addEventListener("scroll", updateScrolled, { passive: true });

    return () => {
      globalThis.removeEventListener("scroll", updateScrolled);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (menuOpen && event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const themeIcons = (
    <>
      <Moon aria-hidden="true" className="block h-4 w-4 dark:hidden" />
      <Sun aria-hidden="true" className="hidden h-4 w-4 dark:block" />
    </>
  );

  const solidHeader = scrolled || menuOpen;

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b transition-colors duration-200 ${
        solidHeader
          ? "border-border/60 bg-background/80 shadow-sh backdrop-blur-md"
          : "border-transparent bg-transparent backdrop-blur-none"
      }`}
    >
      <div
        className={`${dsContainer} relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 sm:py-5`}
      >
        <a
          aria-label={LANDING_COPY.brandAria}
          className="inline-flex items-center gap-3 rounded-md transition hover:opacity-80 max-md:min-h-11"
          href="#top"
        >
          <BrandMark size={32} />
          <span className="font-serif text-card-title leading-none tracking-tight text-foreground">
            {LANDING_COPY.brand}
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((item) => (
            <a className={dsNavLink} href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Button asChild variant="outline">
            <a href="/signin">{LANDING_COPY.nav.signIn}</a>
          </Button>
          <Button asChild variant="primary">
            <a href="/signup">{LANDING_COPY.nav.startTrial}</a>
          </Button>
          <Button ariaLabel={label} onClick={toggleTheme} size="iconLg" variant="outline">
            {themeIcons}
          </Button>
        </div>

        <div className="flex items-center gap-2.5 lg:hidden">
          <Button asChild size="sm" variant="primary">
            <a href="/signup">{LANDING_COPY.nav.startTrial}</a>
          </Button>
          <Button
            ariaControls="landing-msheet"
            ariaExpanded={menuOpen}
            ariaLabel={menuOpen ? "Close menu" : "Open menu"}
            onClick={toggleMenu}
            size="iconLg"
            variant="outline"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </Button>
        </div>

        {menuOpen ? (
          <Card
            className="absolute inset-x-5 top-full z-50 mt-1 px-5 pb-4 pt-2 sm:inset-x-8 lg:hidden"
            id="landing-msheet"
            variant="elevated"
          >
            {NAV_LINKS.map((item) => (
              <a
                className="flex min-h-12 items-center border-b border-border text-sm font-medium text-foreground"
                href={item.href}
                key={item.href}
                onClick={closeMenu}
              >
                {item.label}
              </a>
            ))}
            <div className="flex min-h-14 items-center justify-between border-b border-border text-sm font-medium text-foreground">
              <span>{LANDING_COPY.nav.theme}</span>
              <Button ariaLabel={label} onClick={toggleTheme} size="iconLg" variant="outline">
                {themeIcons}
              </Button>
            </div>
            <Button asChild className="mt-4 w-full" variant="outline">
              <a href="/signin">{LANDING_COPY.nav.signIn}</a>
            </Button>
          </Card>
        ) : null}
      </div>
    </header>
  );
}
