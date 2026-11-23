import { z } from "zod";

const sseEventSchema = z.object({
  id: z.string(),
  event: z.string(),
  data: z.string(),
});

export type SseEvent = z.infer<typeof sseEventSchema>;

export function extractSseEvents(buffer: string) {
  const lastBoundary = buffer.lastIndexOf("\n\n");
  const complete = buffer.slice(0, lastBoundary + 2);
  const events: SseEvent[] = [];

  for (const block of complete.split("\n\n")) {
    if (block.trim() === "" || block.startsWith(":")) {
      continue;
    }

    const lines = block.split("\n");
    const idLine = lines.find((l) => l.startsWith("id:"));
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));

    if (idLine !== undefined && eventLine !== undefined && dataLine !== undefined) {
      events.push(
        sseEventSchema.parse({
          id: idLine.slice(3),
          event: eventLine.slice(6),
          data: dataLine.slice(5),
        }),
      );
    }
  }

  return { events, remainder: buffer.slice(complete.length) };
}

async function openSse(
  url: string,
  lastEventId: string | null,
  headers: Record<string, string> = {},
) {
  const requestHeaders = { ...headers };

  if (lastEventId !== null) {
    requestHeaders["Last-Event-ID"] = lastEventId;
  }

  const response = await fetch(url, { headers: requestHeaders });

  if (!response.ok || response.body === null) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readBatch() {
    const { done, value } = await reader.read();

    if (done) {
      return null;
    }

    buffer += decoder.decode(value, { stream: true });

    const { events, remainder } = extractSseEvents(buffer);

    buffer = remainder;

    if (events.length === 0) {
      return readBatch();
    }

    return events;
  }

  async function close() {
    await reader.cancel();
  }

  return { readBatch, close };
}

export async function readOneSseEvent(
  url: string,
  lastEventId: string | null,
  headers: Record<string, string> = {},
) {
  const stream = await openSse(url, lastEventId, headers);

  if (stream === null) {
    return null;
  }

  const events = await stream.readBatch();
  await stream.close();

  return events === null ? null : (events[0] ?? null);
}

export async function readSseEventUntil(
  url: string,
  lastEventId: string | null,
  matches: (event: SseEvent) => boolean,
  headers: Record<string, string> = {},
) {
  const stream = await openSse(url, lastEventId, headers);

  if (stream === null) {
    return null;
  }

  const sse = stream;

  async function readUntilMatch() {
    const events = await sse.readBatch();

    if (events === null) {
      await sse.close();

      return null;
    }

    const matched = events.find((event) => matches(event));

    if (matched !== undefined) {
      await sse.close();

      return matched;
    }

    return readUntilMatch();
  }

  return readUntilMatch();
}
