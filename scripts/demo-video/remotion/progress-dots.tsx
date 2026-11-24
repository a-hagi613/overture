import type { ChapterId } from "./chapters.ts";
import { CHAPTER_ORDER } from "./chapters.ts";
import { EMBER } from "./theme.ts";

function dotStyle(isActive: boolean, isDone: boolean) {
  if (isActive) {
    return { backgroundColor: EMBER.signal, border: `1px solid ${EMBER.signal}` };
  }

  if (isDone) {
    return { backgroundColor: EMBER.foreground, border: `1px solid ${EMBER.foreground}` };
  }

  return { backgroundColor: EMBER.card, border: `1px solid ${EMBER.input}` };
}

export function ProgressDots({ active }: { active: ChapterId }) {
  const index = CHAPTER_ORDER.indexOf(active);

  return (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      {CHAPTER_ORDER.map((id, dotIndex) => (
        <span
          key={id}
          style={{
            ...dotStyle(dotIndex === index, index > dotIndex),
            borderRadius: 999,
            display: "inline-block",
            height: 7,
            width: dotIndex === index ? 22 : 7,
          }}
        />
      ))}
    </div>
  );
}
