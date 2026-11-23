import { RouteErrorCard } from "./route-error-card.tsx";

export function RouteErrorPage() {
  return (
    <RouteErrorCard
      onRetry={() => {
        globalThis.location.reload();
      }}
    />
  );
}
