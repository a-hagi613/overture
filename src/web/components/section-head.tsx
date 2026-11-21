import type { ReactNode } from "react";

export function SectionHead(props: { headingId: string; intro: string; title: ReactNode }) {
  return (
    <div>
      <h2 className="font-serif text-[30px] leading-[1.1]" id={props.headingId}>
        {props.title}
      </h2>
      <p className="mt-[3px] max-w-[62ch] text-[13.5px] text-muted-foreground">{props.intro}</p>
    </div>
  );
}
