import { copy } from "../../shared/copy.ts";

export function RouteFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  const content = (
    <output aria-busy="true" className="block w-full min-w-0 animate-pulse space-y-5 py-4">
      <span className="sr-only">{copy.shell.loadingPage}</span>
      <div aria-hidden="true" className="h-8 w-48 max-w-full rounded-lg bg-muted" />
      <div aria-hidden="true" className="h-36 w-full rounded-xl border border-border bg-card" />
      <div aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-28 rounded-xl border border-border bg-card" />
        <div className="h-28 rounded-xl border border-border bg-card" />
      </div>
    </output>
  );

  if (!fullScreen) {
    return content;
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background px-4 py-8 text-foreground md:px-7">
      <div className="mx-auto w-full max-w-[1440px]">{content}</div>
    </div>
  );
}
