import { ScoreRing } from "./score-ring.tsx";

export function ReceiptHead({
  monogram,
  title,
  meta,
}: {
  monogram: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md bg-foreground font-serif text-lg italic text-background">
          {monogram}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-serif text-2xl leading-[1.08]">{title}</h2>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{meta}</p>
        </div>
      </div>
      <ScoreRing />
    </div>
  );
}
