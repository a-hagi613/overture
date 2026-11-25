import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { monthName } from "../lib/calendar-format.ts";
import { Calendar } from "./ui/calendar.tsx";

export function CalendarDatePickerPopover({
  month,
  onSelectDate,
  selected,
}: {
  month: Date;
  onSelectDate: (date: Date) => void;
  selected: Date;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(month);
  const monthNumber = month.getMonth() + 1;
  const year = month.getFullYear();

  return (
    <Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (nextOpen) {
          setViewMonth(month);
        }
      }}
      open={open}
    >
      <Trigger asChild>
        <button
          className="inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:gap-2 sm:px-2 md:min-h-0"
          id="calendar-month"
          type="button"
        >
          <span className="whitespace-nowrap font-sans text-base font-semibold text-foreground sm:text-panel-title">
            {`${monthName(monthNumber)} ${String(year)}`}
          </span>
          <span className="sr-only">{`: ${copy.calendar.jumpToDate}`}</span>
          <CalendarDays aria-hidden="true" className="shrink-0 text-muted-foreground" size={16} />
          <ChevronDown aria-hidden="true" className="shrink-0 text-muted-foreground" size={14} />
        </button>
      </Trigger>
      <Portal>
        <Content align="start" className="z-40 mt-2 focus:outline-none" sideOffset={4}>
          <Calendar
            month={viewMonth}
            onMonthChange={setViewMonth}
            onSelect={(picked) => {
              if (picked !== undefined) {
                onSelectDate(picked);
                setOpen(false);
              }
            }}
            selected={selected}
          />
        </Content>
      </Portal>
    </Root>
  );
}
