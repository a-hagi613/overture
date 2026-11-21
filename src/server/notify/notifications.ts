import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { notifications } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";

export interface NotificationInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  url: string;
}

export function createNotification(db: AppDatabase, clock: Clock, input: NotificationInput) {
  const id = crypto.randomUUID();

  db.insert(notifications)
    .values({
      id,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url,
      createdAt: clock.now(),
    })
    .run();

  publishEvent(db, clock, "notification", JSON.stringify({ id, kind: input.kind }), input.userId);

  return id;
}
