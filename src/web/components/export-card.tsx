import type { ReactNode } from "react";

export function ExportCard(props: {
  action?: ReactNode;
  children?: ReactNode;
  heading: string;
  pill?: { label: string; tone: "ready" | "plain" };
}) {
  const { action, children, heading, pill } = props;

  return (
    <section
      aria-labelledby="export-card-heading"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]" id="export-card-heading">
        {heading}
      </h2>
      {pill === undefined ? null : (
        <p
          className={`mt-2 inline-flex h-[22px] items-center rounded-full px-2.5 text-[12.5px] font-semibold leading-none ${
            pill.tone === "ready" ? "bg-ok-soft text-ok" : "bg-muted text-foreground"
          }`}
        >
          {pill.label}
        </p>
      )}
      {children}
      {action === undefined ? null : <div className="mt-3.5">{action}</div>}
    </section>
  );
}
