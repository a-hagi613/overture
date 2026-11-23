import { copy } from "../../shared/copy.ts";
import { Card } from "./ui/card.tsx";

export function SectionSkeleton({ className = "mt-6" }: { className?: string }) {
  return (
    <Card ariaBusy className={className}>
      <output aria-busy="true" className="block animate-pulse space-y-3">
        <span className="sr-only">{copy.shell.loadingPage}</span>
        <span aria-hidden="true" className="block h-6 w-1/3 rounded bg-muted" />
        <span aria-hidden="true" className="block h-24 w-full rounded bg-muted" />
        <span aria-hidden="true" className="block h-10 w-2/3 rounded bg-muted" />
      </output>
    </Card>
  );
}
