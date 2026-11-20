import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { createSseStream, publishEvent } from "../platform/sse/stream.ts";
import {
  getAllKillSwitches,
  getAllSettings,
  getSetting,
  setKillSwitch,
  setSetting,
} from "../platform/settings/index.ts";

const settingPutBody = z.object({ value: z.string().min(1) });

const killSwitchBody = z.object({
  enabled: z.boolean(),
  reason: z.string().default(""),
  setBy: z.enum(["auto", "owner"]).default("owner"),
});

const publishBody = z.object({
  topic: z.string().min(1),
  payload: z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())),
  userId: z.string().optional(),
});

export function createApiRoutes(db: AppDatabase, clock: Clock) {
  const routes = new Hono();

  routes.get("/events", (context) => {
    const lastEventId = context.req.header("Last-Event-ID") ?? null;
    const userId = context.req.query("userId") ?? null;
    const abortController = new AbortController();

    context.req.raw.signal.addEventListener("abort", () => {
      abortController.abort();
    });

    const stream = createSseStream(db, clock, lastEventId, userId, abortController.signal);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  routes.get("/settings", (context) => {
    const all = getAllSettings(db);

    return context.json(all);
  });

  routes.get("/settings/:key", (context) => {
    const { key } = context.req.param();
    const value = getSetting(db, key);

    if (value === null) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json({ key, value });
  });

  routes.put("/settings/:key", zValidator("json", settingPutBody), (context) => {
    const { key } = context.req.param();
    const { value } = context.req.valid("json");

    setSetting(db, clock, key, value, "owner");

    return context.json({ key, value });
  });

  routes.get("/kill-switches", (context) => {
    const all = getAllKillSwitches(db);

    return context.json(all);
  });

  routes.put("/kill-switches/:scope/:key", zValidator("json", killSwitchBody), (context) => {
    const { scope, key } = context.req.param();
    const { enabled, reason, setBy } = context.req.valid("json");

    const validScope = z.enum(["global", "ats", "employer", "provider"]).safeParse(scope);

    if (!validScope.success) {
      return context.json({ error: "invalid scope" }, 400);
    }

    setKillSwitch(db, clock, validScope.data, key, enabled, reason, setBy);

    return context.json({ scope, key, enabled, reason, setBy });
  });

  routes.post("/events/publish", zValidator("json", publishBody), (context) => {
    const { topic, payload, userId } = context.req.valid("json");

    publishEvent(db, clock, topic, JSON.stringify(payload), userId);

    return context.json({ ok: true });
  });

  return routes;
}
