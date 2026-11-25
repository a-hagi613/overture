import type { ChapterId } from "./chapters.ts";
import { ProgressDots } from "./progress-dots.tsx";
import { FONT } from "./theme.ts";

export function ChapterPill({
  active,
  enterSpring,
  label,
}: {
  active: ChapterId;
  enterSpring: number;
  label: string;
}) {
  const scale = 0.92 + enterSpring * 0.08;
  const translateY = (1 - enterSpring) * 10;

  return (
    <div
      style={{
        alignItems: "center",
        backgroundColor: "rgba(21, 19, 17, 0.9)",
        border: "1px solid rgba(251, 248, 242, 0.14)",
        borderRadius: 999,
        boxShadow: "0 14px 32px -12px rgba(21, 19, 17, 0.42)",
        display: "inline-flex",
        gap: 12,
        opacity: enterSpring,
        padding: "8px 14px",
        transform: `translateY(${String(translateY)}px) scale(${String(scale)})`,
      }}
    >
      <span
        style={{
          backgroundColor: "#D2561F",
          borderRadius: 999,
          display: "inline-block",
          height: 7,
          width: 7,
        }}
      />
      <span
        style={{
          color: "#FBF8F2",
          fontFamily: FONT.sans,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.01em",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          backgroundColor: "rgba(251, 248, 242, 0.2)",
          height: 12,
          width: 1,
        }}
      />
      <ProgressDots active={active} inverse />
    </div>
  );
}
