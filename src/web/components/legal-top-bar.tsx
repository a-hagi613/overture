import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function LegalTopBar() {
  return (
    <header className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-[16px] px-[clamp(18px,4vw,40px)] pt-[18px] pb-[18px] md:pt-[22px]">
      <Link
        aria-label={copy.brand.homeAria}
        className="inline-flex items-center gap-[10px] rounded-md"
        to="/"
      >
        <BrandMark size={34} />
        <span className="font-serif text-[27px] leading-none">{copy.app.name}</span>
      </Link>
      <ThemeToggle className="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-card hover:bg-muted" />
    </header>
  );
}
