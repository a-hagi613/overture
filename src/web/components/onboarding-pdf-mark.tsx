export function OnboardingPdfMark() {
  return (
    <div
      aria-hidden="true"
      className="flex h-[98px] w-[76px] flex-none flex-col gap-[5px] rounded border border-border bg-card p-[9px] shadow-sh"
    >
      <span className="h-1.5 w-[60%] rounded-[2px] bg-foreground" />
      <span className="h-[3px] w-[85%] bg-input" />
      <span className="h-[3px] w-[78%] bg-input" />
      <span className="mt-1 h-[3px] w-[90%] bg-input" />
      <span className="h-[3px] w-[70%] bg-input" />
      <span className="mt-1 h-[3px] w-[88%] bg-input" />
      <span className="h-[3px] w-[64%] bg-input" />
    </div>
  );
}
