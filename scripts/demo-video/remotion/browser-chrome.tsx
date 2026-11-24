import { ChromeDot } from "./chrome-dot.tsx";
import { DEMO_COPY } from "./copy.ts";
import { EMBER } from "./theme.ts";
import { type } from "./type.ts";

export function BrowserChrome({ url }: { url: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        backgroundColor: EMBER.card,
        borderBottom: `1px solid ${EMBER.border}`,
        display: "flex",
        gap: 12,
        height: 36,
        padding: "0 14px",
      }}
    >
      <div style={{ display: "flex", gap: 5 }}>
        <ChromeDot />
        <ChromeDot />
        <ChromeDot />
      </div>
      <span
        style={{
          ...type.mono,
          backgroundColor: EMBER.muted,
          borderRadius: 5,
          fontSize: 11,
          padding: "3px 9px",
        }}
      >
        {url}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ ...type.mono, fontSize: 11 }}>{DEMO_COPY.sampleData}</span>
    </div>
  );
}
