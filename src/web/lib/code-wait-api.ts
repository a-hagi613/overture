import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { CODE_WAIT_ASK_MS } from "../../shared/code-wait.ts";

const waitSchema = z.object({
  applicationId: z.string(),
  attemptId: z.string().nullable(),
  company: z.string(),
  expiresAt: z.number(),
  id: z.string(),
  startedAt: z.number(),
  title: z.string(),
});

export type CodeWait = z.infer<typeof waitSchema>;

const waitsSchema = z.object({
  now: z.number(),
  waits: z.array(waitSchema),
});

export type CodeWaits = z.infer<typeof waitsSchema>;

const pastedSchema = z.object({
  id: z.string(),
  resolvedAt: z.number(),
  resolvedBy: z.string(),
});

export type CodePasteOutcome = "expired" | "resolved" | "not_found" | "failed";

export class CodePasteError extends Error {
  outcome: CodePasteOutcome;

  constructor(outcome: CodePasteOutcome) {
    super(outcome);
    this.name = "CodePasteError";
    this.outcome = outcome;
  }
}

async function loadWaits() {
  const response = await fetch("/api/mail/code-waits");

  if (!response.ok) {
    throw new Error(`The code-wait request did not go through (${String(response.status)}).`);
  }

  return waitsSchema.parse(await response.json());
}

export function useCodeWaits() {
  return useQuery({
    queryFn: loadWaits,
    queryKey: ["code-waits"],
    refetchInterval: (query) => ((query.state.data?.waits.length ?? 0) > 0 ? 10_000 : false),
  });
}

async function pasteCode(input: { code: string; waitId: string }) {
  const response = await fetch(`/api/mail/code-waits/${encodeURIComponent(input.waitId)}`, {
    body: JSON.stringify({ code: input.code }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = z.object({ error: z.string() }).safeParse(body);
    const error = parsed.success ? parsed.data.error : "";

    if (response.status === 409 && error === "expired") {
      throw new CodePasteError("expired");
    }

    if (response.status === 409 && error === "already resolved") {
      throw new CodePasteError("resolved");
    }

    if (response.status === 404) {
      throw new CodePasteError("not_found");
    }

    throw new CodePasteError("failed");
  }

  return pastedSchema.parse(await response.json());
}

export function usePasteCode() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: pasteCode,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["code-waits"] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["board"] }),
        client.invalidateQueries({ queryKey: ["application"] }),
      ]);
    },
  });
}

export function isAtAskTime(wait: CodeWait, now: number) {
  return now >= wait.startedAt + CODE_WAIT_ASK_MS;
}

export function remainingMs(wait: CodeWait, now: number) {
  return Math.max(0, wait.expiresAt - now);
}

export function clockText(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function useServerTime(serverNow: number | undefined) {
  const [tick, setTick] = useState({ base: 0, elapsed: 0 });

  useEffect(() => {
    const startedAt = performance.now();

    const timer = globalThis.setInterval(() => {
      if (serverNow !== undefined) {
        setTick({ base: serverNow, elapsed: performance.now() - startedAt });
      }
    }, 1000);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [serverNow]);

  if (serverNow === undefined) {
    return 0;
  }

  return serverNow + (tick.base === serverNow ? tick.elapsed : 0);
}
