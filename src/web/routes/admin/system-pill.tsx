export type SystemTone = "neutral" | "ok" | "warn";

const tones: Record<SystemTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-ok-soft text-ok",
  warn: "bg-need-soft text-need",
};

export function SystemPill({ label, tone }: { label: string; tone: SystemTone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
