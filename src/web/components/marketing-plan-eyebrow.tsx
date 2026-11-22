/**
 * The small mono label above a plan's name on the pricing cards.
 * @param props The label text.
 * @returns The plan eyebrow element.
 */
export function MarketingPlanEyebrow(props: { children: string }) {
  return (
    <p className="font-mono text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
      {props.children}
    </p>
  );
}
