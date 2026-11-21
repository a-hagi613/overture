import { copy } from "../../shared/copy.ts";

export function InboxError(props: { onRetry: () => void }) {
  return (
    <section
      className="mt-[18px] flex flex-col items-start gap-3 rounded-lg border border-border bg-card px-6 py-5.5 shadow-sh max-md:px-4"
      role="alert"
    >
      <p className="text-[14.5px]">{copy.inbox.loadFailed}</p>
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted max-md:min-h-11"
        onClick={props.onRetry}
        type="button"
      >
        {copy.inbox.retry}
      </button>
    </section>
  );
}
