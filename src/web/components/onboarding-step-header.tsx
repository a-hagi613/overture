import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { BrandMark } from "./brand-mark.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import { Button } from "./ui/button.tsx";

export function OnboardingStepHeader() {
  const navigate = useNavigate();

  const signOut = async () => {
    await authClient.signOut();
    await navigate("/signin");
  };

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          aria-label={copy.brand.homeAria}
          className="inline-flex items-center gap-2.5 rounded-md transition hover:opacity-80 max-md:min-h-11"
          to="/"
        >
          <BrandMark size={26} />
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
      </div>
    </header>
  );
}
