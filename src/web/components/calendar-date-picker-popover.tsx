import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { monthName } from "../lib/calendar-format.ts";
import { Calendar } from "./ui/calendar.tsx";
import { dsCardTitle } from "./ui/ds.ts";

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
          aria-label={copy.calendar.jumpToDate}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left transition hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          id="calendar-month"
          type="button"
        >
          <span className={dsCardTitle}>{`${monthName(monthNumber)} ${String(year)}`}</span>
          <CalendarDays aria-hidden="true" className="text-muted-foreground" size={17} />
          <ChevronDown aria-hidden="true" className="text-muted-foreground" size={14} />
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
