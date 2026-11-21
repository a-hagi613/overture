import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { clockText, remainingMs, useServerTime } from "../lib/code-wait-api.ts";

const PRIMARY =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover disabled:opacity-60";

const SECONDARY =
  "inline-flex min-h-10 max-[767px]:min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted disabled:opacity-60";

export function HomeCodeWait({
  onNoCode,
  onPaste,
  serverNow,
  wait,
}: {
  onNoCode: () => void;
  onPaste: () => void;
  serverNow: number | undefined;
  wait: CodeWait;
}) {
  const now = useServerTime(serverNow);

  return (
    <section
      aria-labelledby="home-code-wait"
      className="mt-[22px] rounded-lg border border-need bg-card px-6 pt-[21px] pb-[22px]"
      data-testid="home-code-wait"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="inline-flex items-center rounded-full bg-need-soft px-[10px] py-[3px] text-[11.5px] leading-[13px] font-semibold text-need">
          {copy.home.codeWait.eyebrow}
        </span>
        <span className="font-mono text-[12.5px] leading-[1.2] tracking-[0.08em] text-need">
          {copy.home.codeWait.expires(clockText(remainingMs(wait, now)))}
        </span>
      </div>
      <h2
        className="mt-[14px] max-md:mt-[15px] font-serif text-[34px] leading-[36px]"
        id="home-code-wait"
      >
        {copy.home.codeWait.titlePlain(wait.company)}{" "}
        <span className="italic">{copy.home.codeWait.titleItalic}</span>
      </h2>
      <p className="mt-3.5 max-w-[660px] text-[14.5px] leading-[22px]">{copy.home.codeWait.body}</p>
      <p className="mt-[13px] text-[13px] leading-[20px] text-muted-foreground">
        {copy.home.codeWait.asked}
      </p>
      <div className="mt-[15px] flex flex-wrap gap-2.5">
        <button className={PRIMARY} onClick={onPaste} type="button">
          {copy.home.codeWait.paste}
        </button>
        <button className={SECONDARY} onClick={onNoCode} type="button">
          {copy.home.codeWait.noCode}
        </button>
      </div>
    </section>
  );
}
