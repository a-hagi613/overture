import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import { Button } from "./ui/button.tsx";
import { dsContainer } from "./ui/ds.ts";

export function OnboardingStepHeader() {
  const navigate = useNavigate();

  const signOut = async () => {
    await authClient.signOut();
    await navigate("/signin");
  };

  return (
    <header className={`${dsContainer} flex w-full items-center justify-between gap-3 py-5`}>
      <Link
        aria-label={copy.brand.homeAria}
        className="inline-flex items-center gap-2.5 rounded-md transition hover:opacity-80 max-md:min-h-11"
        to="/"
      >
        <BrandMark size={30} />
        <span className="font-serif text-card-title leading-none text-foreground">
          {copy.app.name}
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <ThemeToggle compact />
        <Button
          onClick={() => {
            void signOut();
          }}
          size="sm"
          variant="ghost"
        >
          <LogOut aria-hidden="true" size={15} />
          <span>{copy.onboarding.signOut}</span>
        </Button>
      </div>
    </header>
  );
}
