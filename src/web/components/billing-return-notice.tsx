/**
 * A Checkout return state: what happened and what it means for the plan.
 * @param props The heading, the status line and the explanation.
 * @returns The notice section.
 */
export function BillingReturnNotice(props: { body: string; line: string; title: string }) {
  const { body, line, title } = props;

  return (
    <section
      aria-live="polite"
      className="mt-7 rounded-lg border border-border bg-card p-[22px_24px_20px] shadow-sh"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]">{title}</h2>
      <p className="mt-2 text-sm font-semibold">{line}</p>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">{body}</p>
    </section>
  );
}
