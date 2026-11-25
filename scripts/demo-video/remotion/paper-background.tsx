import { AbsoluteFill } from "remotion";
import type { ReactNode } from "react";

import { EMBER } from "./theme.ts";

export function PaperBackground({ children }: { children: ReactNode }) {
  return <AbsoluteFill style={{ backgroundColor: EMBER.background }}>{children}</AbsoluteFill>;
}
