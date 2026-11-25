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
      className="mt-3 border-need/40 p-4"
      dataTestId="home-code-wait"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Badge variant="need">{copy.home.codeWait.eyebrow}</Badge>
        <span className={`${dsMono} text-need`}>
          {copy.home.codeWait.expires(clockText(remainingMs(wait, now)))}
        </span>
      </div>
      <h2 className={`${dsCardTitle} mt-2.5`} id="home-code-wait">
        {`${copy.home.codeWait.titlePlain(wait.company)} ${copy.home.codeWait.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1.5 max-w-2xl text-foreground`}>{copy.home.codeWait.body}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {copy.home.codeWait.asked}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onPaste} size="sm" variant="primary">
          {copy.home.codeWait.paste}
        </Button>
        <Button onClick={onNoCode} size="sm" variant="secondary">
          {copy.home.codeWait.noCode}
        </Button>
      </div>
    </Card>
  );
}
