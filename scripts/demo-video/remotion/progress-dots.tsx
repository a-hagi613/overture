import { CHAPTER_ORDER } from "./chapters.ts";
import type { ChapterId } from "./chapters.ts";

export function ProgressDots({
  active,
  inverse = false,
}: {
  active: ChapterId;
  inverse?: boolean;
}) {
  const index = CHAPTER_ORDER.indexOf(active);

  return (
    <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
      {CHAPTER_ORDER.map((id, dotIndex) => {
        const isActive = dotIndex === index;
        const isDone = index > dotIndex;

        let background = inverse ? "rgba(251, 248, 242, 0.28)" : "rgba(21, 19, 17, 0.18)";

        if (isActive) {
          background = "#D2561F";
        } else if (isDone) {
          background = inverse ? "rgba(251, 248, 242, 0.62)" : "#151311";
        }

        return (
          <span
            key={id}
            style={{
              backgroundColor: background,
              borderRadius: 999,
              display: "inline-block",
              height: 6,
              width: isActive ? 18 : 6,
            }}
          />
        );
      })}
    </div>
  );
}
