import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const sseEventSchema = z.object({
  id: z.string(),
  event: z.string(),
  data: z.string(),
});

const publishOkSchema = z.object({ ok: z.boolean() });

function parseFirstSseEvent(text: string) {
  const blocks = text.split("\n\n");

  for (const block of blocks) {
    if (block.trim() === "" || block.startsWith(":")) {
      continue;
    }

    const lines = block.split("\n");
    const idLine = lines.find((l) => l.startsWith("id:"));
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));

    if (idLine !== undefined && eventLine !== undefined && dataLine !== undefined) {
      return sseEventSchema.parse({
        id: idLine.slice(3),
        event: eventLine.slice(6),
        data: dataLine.slice(5),
      });
    }
  }

  return null;
}

async function readOneSseEvent(url: string, lastEventId: string | null) {
  const headers: Record<string, string> = {};

  if (lastEventId !== null) {
    headers["Last-Event-ID"] = lastEventId;
  }

  const response = await fetch(url, { headers });

  if (!response.ok || response.body === null) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readNext() {
    const { done, value } = await reader.read();

    if (done) {
      return null;
    }

    buffer += decoder.decode(value, { stream: true });

    const event = parseFirstSseEvent(buffer);

    if (event !== null) {
      void reader.cancel();

      return event;
    }

    return readNext();
  }

  return readNext();
}

test("a page receives an event live and replays missed events after reconnecting", async ({
  appServerUrl,
}) => {
  const publishFirst = await fetch(`${appServerUrl}/__test__/events/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "home.updated", payload: { kind: "test" } }),
  });

  expect(publishFirst.ok).toBe(true);
  publishOkSchema.parse(await publishFirst.json());

  const firstEvent = await readOneSseEvent(`${appServerUrl}/api/events`, null);

  expect(firstEvent).not.toBeNull();
  expect(firstEvent?.event).toBe("home.updated");

  const firstId = firstEvent?.id ?? "0";

  const publishSecond = await fetch(`${appServerUrl}/__test__/events/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "application.updated", payload: { kind: "replay" } }),
  });

  expect(publishSecond.ok).toBe(true);

  const replayedEvent = await readOneSseEvent(`${appServerUrl}/api/events`, firstId);

  expect(replayedEvent).not.toBeNull();
  expect(replayedEvent?.event).toBe("application.updated");
});
