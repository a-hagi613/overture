const weights = {
  analytics: 90_000,
  app: 150_000,
  data: 60_000,
  font: 180_000,
  image: 240_000,
  media: 512_000,
  pixel: 3000,
  turnstile: 40_000,
} as const;

const bodies = new Map<string, { bytes: number; type: string }>([
  ["/analytics.js", { bytes: weights.analytics, type: "text/javascript" }],
  ["/app.js", { bytes: weights.app, type: "text/javascript" }],
  ["/data.json", { bytes: weights.data, type: "application/json" }],
  ["/font.woff2", { bytes: weights.font, type: "font/woff2" }],
  ["/image.png", { bytes: weights.image, type: "image/png" }],
  ["/media.mp4", { bytes: weights.media, type: "video/mp4" }],
  ["/pixel.gif", { bytes: weights.pixel, type: "image/gif" }],
  ["/turnstile.js", { bytes: weights.turnstile, type: "text/javascript" }],
]);

export const ALLOWED_WEIGHT_PATHS = ["/", "/app.js", "/data.json", "/image.png", "/turnstile.js"];
export const TRIMMED_WEIGHT_PATHS = ["/analytics.js", "/font.woff2", "/media.mp4", "/pixel.gif"];

export const allowedWeightBytes = weights.app + weights.data + weights.image + weights.turnstile;

export const trimmedWeightBytes = weights.analytics + weights.font + weights.media + weights.pixel;

export interface ProxyWeightFixture {
  url: string;
  requests: () => string[];
  bytesServed: () => number;
  reset: () => void;
  close: () => void;
}

const page = (port: number) => `<!doctype html>
<html><head><style>
@font-face { font-family: Weight; src: url("/font.woff2") format("woff2"); }
body { font-family: Weight, sans-serif; }
</style></head><body>
<h1>Weight page</h1>
<img src="/image.png" alt="">
<script src="/app.js"></script>
<script src="http://www.doubleclick.net:${String(port)}/analytics.js"></script>
<img src="http://clarity.ms:${String(port)}/pixel.gif" alt="">
<script src="http://hcaptcha.com:${String(port)}/turnstile.js"></script>
<video autoplay muted playsinline preload="auto" src="/media.mp4"></video>
<script>void fetch("/data.json");</script>
</body></html>`;

export function startProxyWeightFixture() {
  let requests: string[] = [];
  let served = 0;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const host = request.headers.get("host") ?? "";

      requests.push(`${host}${url.pathname}`);

      if (url.pathname === "/") {
        const html = page(server.port ?? 0);

        served += Buffer.byteLength(html);

        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      const body = bodies.get(url.pathname);

      if (body === undefined) {
        return new Response("not found", { status: 404 });
      }

      served += body.bytes;

      return new Response(new Uint8Array(body.bytes), {
        headers: { "content-length": String(body.bytes), "content-type": body.type },
      });
    },
  });

  return {
    bytesServed: () => served,
    close: () => {
      void server.stop(true);
    },
    requests: () => [...requests],
    reset: () => {
      requests = [];
      served = 0;
    },
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies ProxyWeightFixture;
}
