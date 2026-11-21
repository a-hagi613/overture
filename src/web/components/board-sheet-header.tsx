import type { ApplicationDetail } from "../lib/board-api.ts";

export function BoardSheetHeader({ detail }: { detail: ApplicationDetail }) {
  return (
    <div className="flex items-start gap-[13px] md:gap-[15px]">
      <div
        aria-hidden="true"
        className="serif flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[9px] bg-foreground text-[27px] italic text-background md:h-[52px] md:w-[52px] md:text-[30px]"
      >
        {detail.company.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-5 font-medium text-muted-foreground md:text-[13px]">
          {detail.company}
          <span className="serif text-[14px] italic md:hidden">
            {` · no. ${detail.application.id.slice(-4)}`}
          </span>
        </p>
        <h2 className="serif mt-px max-md:max-w-[238px] text-[30px] leading-[1.05] md:max-w-none md:text-[36px]">
          {detail.posting.title}
        </h2>
      </div>
    </div>
  );
}
