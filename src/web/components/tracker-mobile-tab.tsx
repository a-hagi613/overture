import { useDroppable } from "@dnd-kit/core";

import { MOBILE_TAB_PREFIX } from "../lib/tracker-lanes.ts";
import type { TrackerLaneKey } from "../lib/tracker-lanes.ts";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";

export function TrackerMobileTab({
  activeDragLane,
  droppable,
  label,
  lane,
}: {
  activeDragLane: TrackerLaneKey | null;
  droppable: boolean;
  label: string;
  lane: TrackerLaneKey;
}) {
  const { isOver, setNodeRef } = useDroppable({
    disabled: !droppable,
    id: `${MOBILE_TAB_PREFIX}${lane}`,
  });

  const isValidDropTarget = droppable && activeDragLane !== null && activeDragLane !== lane;

  let dropClass = "";

  if (isOver && isValidDropTarget) {
    dropClass = "bg-signal text-primary-ink ring-2 ring-signal";
  } else if (isValidDropTarget) {
    dropClass = "border border-dashed border-signal/60 bg-signal-soft/50 text-signal-text";
  }

  return (
    <div className="min-w-0 flex-1" ref={setNodeRef}>
      <SegmentedControlItem
        className={`w-full whitespace-nowrap px-1.5 text-xs transition ${dropClass}`}
        value={lane}
      >
        {label}
      </SegmentedControlItem>
    </div>
  );
}
