import type { CSSProperties } from "react";

import { ChapterPill } from "./chapter-pill.tsx";
import type { Chapter } from "./chapters.ts";
import { EMBER } from "./theme.ts";
import { type } from "./type.ts";

export function ChapterCopy({
  chapter,
  compact,
  showBody = true,
  style,
}: {
  chapter: Chapter;
  compact: boolean;
  showBody?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", ...style }}>
      <ChapterPill label={chapter.pill} />
      <div
        style={{
          ...(compact ? type.titleMobile : type.titleDesktop),
          marginTop: compact ? 14 : 20,
          textWrap: "balance",
        }}
      >
        {chapter.titlePlain}
        <em style={{ fontStyle: "italic" }}>{chapter.titleItalic}</em>
      </div>
      {showBody ? (
        <div
          style={{
            ...type.body,
            color: EMBER.inkMuted,
            marginTop: compact ? 10 : 16,
            maxWidth: compact ? 560 : 232,
            textWrap: "pretty",
          }}
        >
          {chapter.body}
        </div>
      ) : null}
    </div>
  );
}
