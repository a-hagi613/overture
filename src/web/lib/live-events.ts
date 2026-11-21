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
] as const;

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
      void queryClient.invalidateQueries({ queryKey: ["home"] });

      if (event.type === "review.created" || event.type === "review.resolved") {
        void queryClient.invalidateQueries({ queryKey: ["reviews"] });
      }

      if (event.type === "application.updated" || event.type === "board.moved") {
        void queryClient.invalidateQueries({ queryKey: ["board"] });
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
