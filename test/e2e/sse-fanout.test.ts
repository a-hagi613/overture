import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";
import { ownerSseSession } from "./sse-auth.ts";

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

test("every connected page of one user receives that user's event once", async ({
  appServerUrl,
}) => {
  const session = await ownerSseSession(appServerUrl);

  try {
    await publish(appServerUrl, { topic: "fanout.seed", payload: {}, userId: session.userId });

    const seed = await readSseEventUntil(
      `${appServerUrl}/api/events`,
      null,
      (event) => event.event === "fanout.seed",
      { cookie: session.cookie },
    );

    expect(seed).not.toBeNull();

    const streams = Array.from({ length: 5 }, async () =>
      readSseEventUntil(
        `${appServerUrl}/api/events`,
        seed?.id ?? "0",
        (event) => event.event === "fanout.live",
        { cookie: session.cookie },
      ),
    );

    await publish(appServerUrl, { topic: "fanout.live", payload: {}, userId: session.userId });

    const received = await Promise.all(streams);

    expect(received.map((event) => event?.event)).toEqual(
      Array.from({ length: 5 }, () => "fanout.live"),
    );
    expect(new Set(received.map((event) => event?.id)).size).toBe(1);
  } finally {
    await session.dispose();
  }
});

test("a signed-out stream is refused and another user's event never reaches the owner", async ({
  appServerUrl,
}) => {
  const anonymous = await fetch(`${appServerUrl}/api/events`);

  expect(anonymous.status).toBe(401);

  const session = await ownerSseSession(appServerUrl);

  try {
    await publish(appServerUrl, {
      topic: "fanout.private",
      payload: {},
      userId: "someone-else",
    });
    await publish(appServerUrl, { topic: "fanout.public", payload: {}, userId: session.userId });

    const topics: string[] = [];

    const found = await readSseEventUntil(
      `${appServerUrl}/api/events`,
      null,
      (event) => {
        topics.push(event.event);

        return event.event === "fanout.public";
      },
      { cookie: session.cookie },
    );

    expect(found).not.toBeNull();
    expect(topics).toContain("fanout.public");
    expect(topics).not.toContain("fanout.private");
  } finally {
    await session.dispose();
  }
});
