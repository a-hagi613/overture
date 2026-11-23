import { RouteErrorCard } from "./route-error-card.tsx";

export function RouteErrorElement() {
  return (
    <RouteErrorCard
      insideShell
      onRetry={() => {
        globalThis.location.reload();
      }}
    />
  );
}
