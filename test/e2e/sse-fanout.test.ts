import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

interface PublishBody {
  topic: string;
  payload: Record<string, string>;
  userId?: string;
}

async function publish(appServerUrl: string, body: PublishBody) {
  const response = await fetch(`${appServerUrl}/__test__/events/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  expect(response.ok).toBe(true);
}

test("every connected page receives a published event once", async ({ appServerUrl }) => {
  await publish(appServerUrl, { topic: "fanout.seed", payload: {} });

  const seed = await readSseEventUntil(
    `${appServerUrl}/api/events`,
    null,
    (event) => event.event === "fanout.seed",
  );

  expect(seed).not.toBeNull();

  const streams = Array.from({ length: 5 }, async () =>
    readSseEventUntil(
      `${appServerUrl}/api/events`,
      seed?.id ?? "0",
      (event) => event.event === "fanout.live",
    ),
  );

  await publish(appServerUrl, { topic: "fanout.live", payload: {} });

  const received = await Promise.all(streams);

  expect(received.map((event) => event?.event)).toEqual(
    Array.from({ length: 5 }, () => "fanout.live"),
  );
  expect(new Set(received.map((event) => event?.id)).size).toBe(1);
});

test("a signed-out page never receives an event addressed to a user", async ({ appServerUrl }) => {
  await publish(appServerUrl, { topic: "fanout.private", payload: {}, userId: "someone-else" });
  await publish(appServerUrl, { topic: "fanout.public", payload: {} });

  const topics: string[] = [];

  const found = await readSseEventUntil(`${appServerUrl}/api/events`, null, (event) => {
    topics.push(event.event);

    return event.event === "fanout.public";
  });

  expect(found).not.toBeNull();
  expect(topics).toContain("fanout.public");
  expect(topics).not.toContain("fanout.private");
});
