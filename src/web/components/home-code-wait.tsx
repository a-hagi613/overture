import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { clockText, remainingMs, useServerTime } from "../lib/code-wait-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";

export function HomeCodeWait({
  onNoCode,
  onPaste,
  serverNow,
  wait,
}: {
  onNoCode: () => void;
  onPaste: () => void;
  serverNow: number | undefined;
  wait: CodeWait;
}) {
  const now = useServerTime(serverNow);

  return (
    <Card
      ariaLabelledBy="home-code-wait"
      className="mt-5 border-need bg-card p-5 md:p-6"
      dataTestId="home-code-wait"
      variant="elevated"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Badge variant="need">{copy.home.codeWait.eyebrow}</Badge>
        <span className={`${dsMono} text-need`}>
          {copy.home.codeWait.expires(clockText(remainingMs(wait, now)))}
        </span>
      </div>
      <h2 className={`${dsCardTitle} mt-3.5`} id="home-code-wait">
        {copy.home.codeWait.titlePlain(wait.company)}{" "}
        <span className="italic">{copy.home.codeWait.titleItalic}</span>
      </h2>
      <p className={`${dsBody} mt-2 max-w-2xl text-foreground`}>{copy.home.codeWait.body}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {copy.home.codeWait.asked}
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button onClick={onPaste} size="default" variant="primary">
          {copy.home.codeWait.paste}
        </Button>
        <Button onClick={onNoCode} size="default" variant="secondary">
          {copy.home.codeWait.noCode}
        </Button>
      </div>
    </Card>
  );
}
