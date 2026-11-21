import { copy } from "../../shared/copy.ts";

export function InboxLoading() {
  return (
    <output
      aria-busy="true"
      aria-label={copy.inbox.loading}
      className="mt-[18px] block overflow-hidden rounded-lg border border-border bg-card shadow-sh"
    >
      <span className="sr-only">{copy.inbox.loading}</span>
      {[0, 1, 2].map((key) => (
        <div
          className="flex items-start gap-3 border-t border-border px-[18px] py-4 first:border-t-0"
          key={key}
        >
          <span className="mt-2 h-2 w-2 flex-none rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-muted" />
            <div className="h-3.5 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      ))}
    </output>
  );
}
