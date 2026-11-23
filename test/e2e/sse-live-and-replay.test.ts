import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";
import { ownerSseSession } from "./sse-auth.ts";

const publishOkSchema = z.object({ ok: z.boolean() });

test("a page receives an event live and replays missed events after reconnecting", async ({
  isolatedAppServer,
}) => {
  const appServerUrl = isolatedAppServer.url;
  const session = await ownerSseSession(appServerUrl);

  try {
    const publishFirst = await fetch(`${appServerUrl}/__test__/events/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: "home.updated",
        payload: { kind: "test" },
        userId: session.userId,
      }),
    });

    expect(publishFirst.ok).toBe(true);
    publishOkSchema.parse(await publishFirst.json());

    const firstEvent = await readSseEventUntil(
      `${appServerUrl}/api/events`,
      null,
      (event) => event.event === "home.updated",
      { cookie: session.cookie },
    );

    expect(firstEvent).not.toBeNull();

    const firstId = firstEvent?.id ?? "0";

    const publishSecond = await fetch(`${appServerUrl}/__test__/events/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: "application.updated",
        payload: { kind: "replay" },
        userId: session.userId,
      }),
    });

    expect(publishSecond.ok).toBe(true);

    const replayedEvent = await readSseEventUntil(
      `${appServerUrl}/api/events`,
      firstId,
      (event) => event.event === "application.updated",
      { cookie: session.cookie },
    );

    expect(replayedEvent).not.toBeNull();
  } finally {
    await session.dispose();
  }
});
