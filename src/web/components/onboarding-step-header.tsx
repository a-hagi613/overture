import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useTheme } from "../lib/theme-context.ts";

export function OnboardingStepHeader() {
  const { theme, toggleTheme, label } = useTheme();
  const navigate = useNavigate();

  const signOut = async () => {
    await authClient.signOut();
    await navigate("/signin");
  };

  return (
    <header className="relative z-[1] flex items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] pb-[18px] pt-[22px]">
      <Link
        aria-label={copy.brand.homeAria}
        className="inline-flex min-h-11 items-center gap-2.5 hover:opacity-80"
        to="/"
      >
        <BrandMark size={30} />
        <span className="serif text-[27px] leading-none">{copy.app.name}</span>
      </Link>
      <div className="flex items-center gap-2">
        <button
          aria-label={label}
          aria-pressed={theme === "dark"}
          className="ibtn"
          onClick={toggleTheme}
          type="button"
        >
          <NavGlyph name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          className="btng"
          onClick={() => {
            void signOut();
          }}
          style={{ minHeight: 44 }}
          type="button"
        >
          <NavGlyph name="signout" size={16} />
          {copy.onboarding.signOut}
        </button>
      </div>
    </header>
  );
}
