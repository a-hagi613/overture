import type { ApplicationDetail } from "../lib/board-api.ts";
import { BoardAnswers } from "./board-answers.tsx";
import { BoardCover } from "./board-cover.tsx";
import { BoardEmails } from "./board-emails.tsx";
import { BoardTimeline } from "./board-timeline.tsx";

export type BoardTab = "timeline" | "answers" | "cover" | "emails";

export function BoardSheetPanel({ detail, tab }: { detail: ApplicationDetail; tab: BoardTab }) {
  switch (tab) {
    case "answers": {
      return <BoardAnswers detail={detail} />;
    }

    case "cover": {
      return <BoardCover detail={detail} />;
    }

    case "emails": {
      return <BoardEmails detail={detail} />;
    }

    default: {
      return <BoardTimeline detail={detail} />;
    }
  }
}
