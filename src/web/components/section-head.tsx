import type { ReactNode } from "react";

export function SectionHead(props: {
  folio: string;
  headingId: string;
  intro: string;
  title: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
      <div>
        <h2 className="font-serif text-[30px] leading-[1.1]" id={props.headingId}>
          {props.title}
        </h2>
        <p className="mt-[3px] max-w-[62ch] text-[13.5px] text-muted-foreground">{props.intro}</p>
      </div>
      <span className="font-serif text-[14px] leading-[1.5] italic text-muted-foreground">
        {props.folio}
      </span>
    </div>
  );
}
