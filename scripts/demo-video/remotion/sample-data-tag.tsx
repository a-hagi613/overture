import { DEMO_COPY } from "./copy.ts";
import { EMBER } from "./theme.ts";
import { type } from "./type.ts";

export function SampleDataTag() {
  return (
    <span
      style={{
        ...type.mono,
        border: `1px solid ${EMBER.border}`,
        borderRadius: 999,
        padding: "5px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {DEMO_COPY.sampleData}
    </span>
  );
}
