import { BrandMark } from "./brand-mark.tsx";
import { DEMO_COPY } from "./copy.ts";
import { type } from "./type.ts";

export function Lockup() {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
      <BrandMark />
      <span style={type.lockup}>{DEMO_COPY.brand}</span>
    </div>
  );
}
