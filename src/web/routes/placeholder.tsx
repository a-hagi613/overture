import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";

export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader lead={copy.placeholder.lead} titleNode={title} />
      <section className="mt-7 rounded-lg border border-border bg-card p-6 shadow-sh">
        <p className="max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">{note}</p>
      </section>
    </div>
  );
}
