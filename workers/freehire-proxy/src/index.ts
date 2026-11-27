interface Env {
  FREEHIRE_ORIGIN: string;
}

const MAX_BODY_BYTES = 256 * 1024;

async function readBounded(request: Request) {
  const body = await request.arrayBuffer();

  return body.byteLength > MAX_BODY_BYTES ? null : body;
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const method = request.method === "POST" ? "POST" : "GET";
    const target = new URL(env.FREEHIRE_ORIGIN);

    target.pathname = url.pathname;
    target.search = url.search;

    const headers = new Headers({
      accept: request.headers.get("accept") ?? "application/json",
      "user-agent": "Overture-Freehire-Proxy/1.0",
    });

    const authorization = request.headers.get("authorization");

    if (authorization !== null) {
      headers.set("authorization", authorization);
    }

    const body = method === "POST" ? await readBounded(request) : undefined;

    if (body === null) {
      return new Response("Request body too large", { status: 413 });
    }

    const init: RequestInit = {
      headers,
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    };

    if (body !== undefined) {
      init.body = body;
    }

    const upstream = await fetch(target, init);

    return new Response(upstream.body, {
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "x-overture-proxy": "freehire",
      },
      status: upstream.status,
    });
  },
};

export default worker;
