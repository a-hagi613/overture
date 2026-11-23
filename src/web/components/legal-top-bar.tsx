import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import { dsContainer } from "./ui/ds.ts";

export function LegalTopBar() {
  return (
    <header className={`${dsContainer} flex w-full items-center justify-between py-5`}>
      <Link
        aria-label={copy.brand.homeAria}
        className="inline-flex items-center gap-2.5 rounded-md transition hover:opacity-80"
        to="/"
      >
        <BrandMark size={30} />
        <span className="font-serif text-card-title leading-none text-foreground">
          {copy.app.name}
        </span>
      </Link>
      <ThemeToggle compact />
    </header>
  );
}
