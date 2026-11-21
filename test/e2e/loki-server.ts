import { createServer } from "node:http";
import { z } from "zod";

const listenAddressSchema = z.object({ port: z.number() });

const pushSchema = z.object({
  streams: z.array(
    z.object({
      stream: z.record(z.string(), z.string()),
      values: z.array(z.tuple([z.string(), z.string()])),
    }),
  ),
});

const auditLineSchema = z.object({
  action: z.string(),
  actorId: z.string(),
  at: z.number(),
  detailKeys: z.array(z.string()),
  id: z.string(),
  reason: z.string(),
  targetUserId: z.string().nullable(),
});

export type LokiPush = z.infer<typeof pushSchema>;

export type LokiAuditEntry = z.infer<typeof auditLineSchema>;

export interface LokiServer {
  url: string;
  pushes: LokiPush[];
  clear: () => void;
  stop: () => Promise<void>;
}

export function lokiAuditEntries(server: LokiServer) {
  const entries: LokiAuditEntry[] = [];

  for (const push of server.pushes) {
    for (const stream of push.streams) {
      for (const [, line] of stream.values) {
        entries.push(auditLineSchema.parse(JSON.parse(line)));
      }
    }
  }

  return entries;
}

export async function startLokiServer() {
  const pushes: LokiPush[] = [];

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/loki/api/v1/push") {
      response.writeHead(404);
      response.end();

      return;
    }

    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        pushes.push(pushSchema.parse(JSON.parse(body)));
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = listenAddressSchema.parse(server.address());

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    pushes,
    clear: () => {
      pushes.length = 0;
    },
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  } satisfies LokiServer;
}
