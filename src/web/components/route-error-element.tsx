import { RouteErrorCard } from "./route-error-card.tsx";

export function RouteErrorElement() {
  return (
    <RouteErrorCard
      onRetry={() => {
        globalThis.location.reload();
      }}
    />
  );
}
