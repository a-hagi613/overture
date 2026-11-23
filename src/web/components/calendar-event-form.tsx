import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { CustomCalendarEventKind } from "../lib/calendar-custom-events.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

const EVENT_TYPES: readonly CustomCalendarEventKind[] = ["interview", "followup", "reminder"];

export function CalendarEventForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    company: string;
    kind: CustomCalendarEventKind;
    time: string;
    title: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [time, setTime] = useState("10:00");
  const [kind, setKind] = useState<CustomCalendarEventKind>("interview");

  const canSave = title.trim() !== "";

  return (
    <Card className="mt-4 border-border bg-background p-4 shadow-none">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();

          if (!canSave) {
            return;
          }

          onSubmit({
            company: company.trim(),
            kind,
            time,
            title: title.trim(),
          });
        }}
      >
        <p className={dsEyebrow}>{copy.calendar.addEventTitle}</p>

        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground" htmlFor="cal-title">
            {copy.calendar.eventTitleLabel}
          </label>
          <Input
            className="h-9 text-xs"
            id="cal-title"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder={copy.calendar.eventTitlePlaceholder}
            value={title}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground" htmlFor="cal-co">
              {copy.calendar.eventCompanyLabel}
            </label>
            <Input
              className="h-9 text-xs"
              id="cal-co"
              onChange={(event) => {
                setCompany(event.target.value);
              }}
              placeholder={copy.calendar.eventCompanyPlaceholder}
              value={company}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground" htmlFor="cal-time">
              {copy.calendar.eventTimeLabel}
            </label>
            <Input
              className="h-9 text-xs"
              id="cal-time"
              onChange={(event) => {
                setTime(event.target.value);
              }}
              type="time"
              value={time}
            />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            {copy.calendar.eventTypeLabel}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_TYPES.map((option) => (
              <Button
                ariaPressed={kind === option}
                key={option}
                onClick={() => {
                  setKind(option);
                }}
                size="sm"
                variant={kind === option ? "primary" : "outline"}
              >
                {copy.calendar.eventTypes[option]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={onCancel} size="sm" variant="outline">
            {copy.calendar.cancelEvent}
          </Button>
          <Button disabled={!canSave} size="sm" submit variant="primary">
            {copy.calendar.saveEvent}
          </Button>
        </div>
      </form>
    </Card>
  );
}
