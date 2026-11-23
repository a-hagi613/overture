import { ChevronDown, ChevronUp, X } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";

export function BoardSheetNavigation(props: {
  nextDisabled: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  positionLabel: string | null;
  previousDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-sidebar/70 px-5 py-3 md:px-7">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground tabular-nums">
        {props.positionLabel ?? ""}
      </span>
      <div className="flex items-center gap-1">
        <Button
          ariaLabel={copy.board.previousCard}
          className="h-8 w-8"
          disabled={props.previousDisabled}
          onClick={props.onPrevious}
          size="icon"
          variant="ghost"
        >
          <ChevronUp aria-hidden="true" size={16} />
        </Button>
        <Button
          ariaLabel={copy.board.nextCard}
          className="h-8 w-8"
          disabled={props.nextDisabled}
          onClick={props.onNext}
          size="icon"
          variant="ghost"
        >
          <ChevronDown aria-hidden="true" size={16} />
        </Button>
        <Button
          ariaLabel={copy.board.closeDetail}
          className="h-8 w-8"
          onClick={props.onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>
    </div>
  );
}
