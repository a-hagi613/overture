import type { ReactNode } from "react";

export function Section(props: { children: ReactNode; id: string; labelledBy: string }) {
  return (
    <section
      aria-labelledby={props.labelledBy}
      className="mt-6 rounded-lg border border-border bg-card px-4 pb-6 pt-5 shadow-sh max-[767px]:mt-4 min-[768px]:px-7 min-[768px]:pb-6 min-[768px]:pt-6"
      id={props.id}
    >
      {props.children}
    </section>
  );
}
