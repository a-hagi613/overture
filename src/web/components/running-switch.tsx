import { copy } from "../../shared/copy.ts";
import { useHomeData, useRunning } from "../lib/home-api.ts";

export function RunningSwitch({ home = false }: { home?: boolean }) {
  const { data } = useHomeData();
  const mutation = useRunning();
  const running = data?.running ?? false;

  return (
    <div
      className={`flex h-10 items-center gap-3 rounded-md border border-input bg-card pl-3.5 pr-1.5 ${
        home ? "max-[767px]:h-auto max-[767px]:w-full max-[767px]:justify-between" : ""
      }`}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${running ? "bg-signal" : "bg-muted-foreground"}`}
        />
        {running ? copy.home.running : copy.home.paused}
      </span>
      {running ? (
        <button
          aria-label={copy.home.switchAria(running)}
          className={`inline-flex h-[30px] items-center justify-center gap-2 rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-60 ${
            home ? "max-[767px]:h-11 max-[767px]:bg-muted" : ""
          }`}
          disabled={mutation.isPending}
          onClick={() => {
            mutation.mutate(false);
          }}
          type="button"
        >
          <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 24 24" width="12">
            <rect height="14" rx="1" width="4" x="6" y="5" />
            <rect height="14" rx="1" width="4" x="14" y="5" />
          </svg>
          {copy.home.pause}
        </button>
      ) : null}
    </div>
  );
}
