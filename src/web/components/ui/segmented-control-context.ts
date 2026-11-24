import { createContext } from "react";
import type { RefObject } from "react";

export interface SegmentedControlState {
  groupRef: RefObject<HTMLFieldSetElement | null>;
  onValueChange: (value: string) => void;
  value: string;
}

export const SegmentedControlContext = createContext<SegmentedControlState | null>(null);
