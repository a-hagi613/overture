import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function LegalTopBar() {
  return (
    <header className="mx-auto flex w-full max-w-[836px] items-center justify-between px-[18px] pt-[20px]">
      <Link
        aria-label={copy.brand.homeAria}
        className="inline-flex max-md:min-h-11 max-md:-my-[6px] items-center gap-[10px] rounded-md hover:opacity-80"
        to="/"
      >
        <BrandMark size={32} />
        <span className="font-serif text-[30px] leading-none tracking-tight">{copy.app.name}</span>
      </Link>
      <ThemeToggle
        compact
        className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted"
      />
    </header>
  );
}
