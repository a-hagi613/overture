import { EMBER } from "./theme.ts";
import { type } from "./type.ts";

export function ChapterPill({ label }: { label: string }) {
  return (
    <span
      style={{
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: EMBER.card,
        border: `1px solid ${EMBER.border}`,
        borderRadius: 999,
        display: "inline-flex",
        gap: 7,
        padding: "7px 12px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          backgroundColor: EMBER.signal,
          borderRadius: 999,
          display: "inline-block",
          height: 6,
          width: 6,
        }}
      />
      <span style={type.pill}>{label}</span>
    </span>
  );
}
