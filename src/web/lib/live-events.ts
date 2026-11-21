import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const LIVE_TOPICS = [
  "home.updated",
  "application.updated",
  "board.moved",
  "review.created",
  "review.resolved",
  "message.received",
  "notification",
] as const;

export function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/events");

    const refresh = (event: Event) => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });

      if (event.type === "review.created" || event.type === "review.resolved") {
        void queryClient.invalidateQueries({ queryKey: ["reviews"] });
      }

      if (event.type === "application.updated" || event.type === "board.moved") {
        void queryClient.invalidateQueries({ queryKey: ["board"] });
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
