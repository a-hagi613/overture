import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { initialsOf } from "../lib/identity.ts";
import { authClient } from "../lib/auth-client.ts";
import { useHomeData } from "../lib/home-api.ts";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function BoardMobileHeader() {
  const { data: home } = useHomeData();
  const { data: session } = authClient.useSession();
  const name = session?.user.name ?? "";
  const initials = name === "" ? "" : initialsOf(name);
  const left = home?.applicationsLeft ?? 0;

  return (
    <header className="flex h-[60px] flex-none items-center justify-between pr-2 pl-[18px]">
      <Link
        aria-label={copy.brand.homeAria}
        className="flex min-h-11 items-center gap-[9px]"
        to="/"
      >
        <BrandMark size={28} />
        <span className="serif text-[25px] leading-none">{copy.app.name}</span>
      </Link>
      <div className="flex items-center gap-0.5">
        <span
          aria-label={copy.home.usageAria(left)}
          className="num mr-1 text-[11.5px] text-muted-foreground"
        >
          <b className="font-semibold text-foreground">{String(left)}</b>
          {" left"}
        </span>
        <ThemeToggle className="flex h-11 w-11 items-center justify-center border-0 bg-transparent text-foreground" />
        <button
          aria-label={copy.sample.bellAria}
          className="relative flex h-11 w-11 items-center justify-center border-0 bg-transparent text-foreground"
          type="button"
        >
          <NavGlyph name="bell" size={20} />
          <span className="num absolute top-1.5 right-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-[9px] bg-foreground px-1 text-[10px] font-bold text-background">
            {copy.sample.inboxUnread}
          </span>
        </button>
        <Link
          aria-label={`${initials}, ${copy.shell.settings}`}
          className="flex h-11 w-11 items-center justify-center"
          to="/settings"
        >
          <span className="serif flex h-8 w-8 items-center justify-center rounded-full border border-input bg-muted text-[15px] italic">
            {initials}
          </span>
        </Link>
      </div>
    </header>
  );
}
