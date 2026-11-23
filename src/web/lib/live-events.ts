import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const LIVE_TOPICS = [
  "home.updated",
  "application.updated",
  "board.moved",
  "review.created",
  "review.resolved",
  "message.received",
  "notification",
  "code.wait_resolved",
  "calendar.updated",
] as const;

type LiveTopic = (typeof LIVE_TOPICS)[number];

const TOPIC_QUERY_KEYS: Record<LiveTopic, readonly (readonly string[])[]> = {
  "application.updated": [["home"], ["nav"], ["board"], ["ready"], ["application"], ["calendar"]],
  "board.moved": [["home"], ["nav"], ["board"], ["ready"], ["application"], ["calendar"]],
  "calendar.updated": [["home"], ["nav"], ["board"], ["calendar"]],
  "code.wait_resolved": [["home"], ["nav"], ["notifications"], ["code-waits"]],
  "home.updated": [["home"], ["nav"], ["ready"]],
  "message.received": [["home"], ["nav"], ["threads"], ["thread"]],
  notification: [["home"], ["nav"], ["notifications"], ["code-waits"]],
  "review.created": [["home"], ["nav"], ["reviews"], ["ready"], ["board"]],
  "review.resolved": [["home"], ["nav"], ["reviews"], ["ready"], ["board"]],
};

function isLiveTopic(value: string): value is LiveTopic {
  return Object.hasOwn(TOPIC_QUERY_KEYS, value);
}

const boardMovedSchema = z.object({
  applicationId: z.string(),
  fromStage: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  stage: z.string().nullable(),
});

export type BoardMovedEvent = z.infer<typeof boardMovedSchema>;

const boardMovedListeners = new Set<(event: BoardMovedEvent) => void>();

export function onBoardMoved(listener: (event: BoardMovedEvent) => void) {
  boardMovedListeners.add(listener);

  return () => {
    boardMovedListeners.delete(listener);
  };
}

function boardMovedFrom(data: string) {
  try {
    const parsed = boardMovedSchema.safeParse(JSON.parse(data));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/events");

    const refresh = (event: MessageEvent) => {
      if (isLiveTopic(event.type)) {
        for (const queryKey of TOPIC_QUERY_KEYS[event.type]) {
          void queryClient.invalidateQueries({ queryKey });
        }
      } else {
        void queryClient.invalidateQueries({ queryKey: ["home"] });
        void queryClient.invalidateQueries({ queryKey: ["nav"] });
      }

      if (event.type === "board.moved") {
        const text = z.string().safeParse(event.data);

        if (text.success) {
          const moved = boardMovedFrom(text.data);

          if (moved !== null) {
            for (const listener of boardMovedListeners) {
              listener(moved);
            }
          }
        }
      }
    };

    for (const topic of LIVE_TOPICS) {
      source.addEventListener(topic, refresh);
    }

    return () => {
      source.close();
    };
  }, [queryClient]);
}
