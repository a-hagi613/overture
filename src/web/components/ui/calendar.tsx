import { DayPicker } from "react-day-picker";

import { cn } from "./cn.ts";

const calendarClassNames = {
  button_next:
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-foreground transition hover:bg-muted",
  button_previous:
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-foreground transition hover:bg-muted",
  caption_label: "hidden",
  day: "h-9 w-9 p-0 text-center text-sm",
  day_button:
    "inline-flex h-9 w-9 items-center justify-center rounded-md font-medium text-foreground transition hover:bg-muted",
  dropdown:
    "rounded-md border border-input bg-card px-2 py-1 text-xs font-semibold text-foreground",
  dropdowns: "flex items-center gap-2",
  month: "flex flex-col gap-3",
  month_caption: "flex items-center justify-between gap-2 px-1",
  month_grid: "w-full border-collapse",
  months: "flex flex-col gap-4",
  nav: "flex items-center gap-1",
  outside: "text-muted-foreground opacity-45",
  selected: "rounded-md bg-foreground text-primary-ink",
  today: "rounded-md border border-signal font-semibold text-signal-text",
  week: "mt-1 flex w-full justify-between",
  weekday: "w-9 text-center font-mono text-xs font-medium text-muted-foreground",
  weekdays: "flex w-full justify-between",
};

export function Calendar({
  className,
  month,
  onMonthChange,
  onSelect,
  selected,
}: {
  className?: string;
  month: Date;
  onMonthChange: (month: Date) => void;
  onSelect: (date: Date | undefined) => void;
  selected?: Date;
}) {
  if (selected === undefined) {
    return (
      <DayPicker
        captionLayout="dropdown"
        className={cn("rounded-xl border border-border bg-card p-4 shadow-sh", className)}
        classNames={calendarClassNames}
        mode="single"
        month={month}
        onMonthChange={onMonthChange}
        onSelect={onSelect}
        showOutsideDays
      />
    );
  }

  return (
    <DayPicker
      captionLayout="dropdown"
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sh", className)}
      classNames={calendarClassNames}
      mode="single"
      month={month}
      onMonthChange={onMonthChange}
      onSelect={onSelect}
      selected={selected}
      showOutsideDays
    />
  );
}
