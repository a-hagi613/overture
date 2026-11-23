import { createContext } from "react";

export interface SegmentedControlState {
  onValueChange: (value: string) => void;
  value: string;
}

export const SegmentedControlContext = createContext<SegmentedControlState | null>(null);
