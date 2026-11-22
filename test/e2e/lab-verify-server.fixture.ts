import { z } from "zod";

export interface LabVerifyFixture {
  url: string;
  calls: number;
  score: number;
  close: () => void;
}

const bodySchema = z.object({ response: z.string().min(1), secret: z.string().min(1) });

export function startLabVerifyServer(score = 0.9) {
  const state = { calls: 0 };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method !== "POST" || url.pathname !== "/recaptcha") {
        return new Response("not found", { status: 404 });
      }

      const parsed = bodySchema.safeParse(
        Object.fromEntries(new URLSearchParams(await request.text())),
      );

      if (!parsed.success) {
        return Response.json({ "error-codes": ["missing-input-response"], success: false });
      }

      state.calls += 1;

      return Response.json({
        action: "lab",
        challenge_ts: new Date().toISOString(),
        hostname: "127.0.0.1",
        score: parsed.data.response === "lab-recaptcha-token" ? score : 0.1,
        success: true,
      });
    },
  });

  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    get calls() {
      return state.calls;
    },
    score,
    close: () => {
      void server.stop(true);
    },
  } satisfies LabVerifyFixture;
}
