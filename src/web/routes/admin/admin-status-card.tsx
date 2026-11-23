import { copy } from "../../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

export function AdminStatusCard({
  className = "mt-7",
  errorMessage = copy.admin.loadFailed,
  failed,
  loadingMessage = copy.admin.loading,
  onRetry,
  retryLabel = copy.admin.retry,
}: {
  className?: string;
  errorMessage?: string;
  failed: boolean;
  loadingMessage?: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  if (failed) {
    return (
      <Card className={className}>
        <p className="text-sm font-semibold text-foreground" role="alert">
          {errorMessage}
        </p>
        <div className="mt-4">
          <Button onClick={onRetry} variant="secondary">
            {retryLabel}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <output aria-busy="true" aria-live="polite" className="block space-y-3">
        <span className="block text-sm text-muted-foreground">{loadingMessage}</span>
        <span aria-hidden="true" className="block h-4 w-2/3 animate-pulse rounded bg-muted" />
        <span aria-hidden="true" className="block h-10 w-full animate-pulse rounded bg-muted" />
      </output>
    </Card>
  );
}
