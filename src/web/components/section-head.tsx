import type { ReactNode } from "react";

export function SectionHead(props: { headingId: string; intro: string; title: ReactNode }) {
  return (
    <div>
      <h2 className="font-serif text-card-title leading-[1.1]" id={props.headingId}>
        {props.title}
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">{props.intro}</p>
    </div>
  );
}
