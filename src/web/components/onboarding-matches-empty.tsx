import { ArrowLeft, Search } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";

const text = copy.onboarding.matches;

export function OnboardingMatchesEmpty({ backTo }: { backTo: string }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-input bg-background px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
        <Search aria-hidden="true" size={20} />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{text.emptyTitle}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        {text.emptyBody}
      </p>
      <Button asChild className="mt-4" size="default" variant="secondary">
        <Link to={backTo}>
          <ArrowLeft aria-hidden="true" size={15} />
          <span>{text.adjustFilters}</span>
        </Link>
      </Button>
    </div>
  );
}
