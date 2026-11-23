import type { ReactNode } from "react";

export type BadgeTone = "ok" | "need" | "signal" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  need: "bg-need-soft text-need",
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-ok-soft text-ok",
  signal: "bg-signal-soft text-signal-text",
};

export function Badge({
  children,
  className = "",
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
