# Marketing Worker

The landing (`/`) and pricing (`/pricing`) pages as Workers Static Assets (#284, ADR 0033). The pages
are prerendered by the main build; this Worker only serves them, and its routes are explicit so no app
or API request ever reaches it.

## Routes

| Route | Serves |
|---|---|
| `tryoverture.com/` | `dist-marketing/index.html` |
| `tryoverture.com/pricing*` | `dist-marketing/pricing/index.html` |

Every other path on `tryoverture.com` — the app routes in `src/web/route-table.tsx`, `/api/*`,
`/webhooks/*`, `/assets/*`, `/sw.js`, the manifest and the icons — matches no route here and goes
straight to `overture-web` on Fly. ADR 0022 (same-origin SPA) is untouched: the marketing pages share
the app's origin, and the app's own HTML and assets still come from Fly.

The route list is derived from `src/shared/marketing-paths.ts` by `src/routes.ts`; a change needs the
matching `routes` entry in `wrangler.jsonc`, and `test/e2e/marketing-worker.test.ts` fails until the
two agree.

## Assets and invocations

`wrangler.jsonc` sets `main` to nothing: this is an assets-only Worker, so serving a page never invokes
a Worker script. Asset requests are free and unlimited, are not counted as Workers requests, and keep
serving when a tripped Workers spending limit blocks script invocations (ADR 0033,
`docs/research/cloudflare-paid-plan.md` §3). `not_found_handling: "none"` returns a 404 for a missing
file instead of falling through to anything, and `workers_dev` is false so the site is only reachable
through the zone routes.

`assets.html_handling` is `drop-trailing-slash`: `/pricing` serves `pricing/index.html` directly and
`/pricing/` redirects to it, which matches the URL the app links to.

`dist-marketing` is written by `scripts/prerender.tsx` after `vite build`:

- one HTML file per page with the built stylesheet inlined, so the page is styled with the origin down;
- the app's `/assets/*.js` bundle is still referenced for hydration, so a signed-in visitor at `/` gets
  the app home when Fly is up;
- `_headers`, generated from `src/shared/security-headers.ts`, sends the app's CSP and security headers
  (Workers Static Assets serves static responses without the Hono middleware).

## Commands

```sh
bun run build
cd workers/marketing
bun run dry-run   # CI runs this; needs dist-marketing
bunx wrangler deploy
bunx wrangler rollback   # previous deployment
bunx wrangler delete     # remove the Worker and its routes; both paths fall back to Fly
```

Deploy and rollback, with the verification steps in the Workers metrics, are in `docs/DEPLOY.md`
("M3-10").

## Tests

`test/e2e/marketing-worker.test.ts` reads the real `wrangler.jsonc`, the route table and the built
`dist-marketing`:

- every route in `src/web/route-table.tsx`, plus the API, webhook and asset prefixes, matches no Worker
  route, with and without a query string;
- the config is assets-only (`main` absent, `not_found_handling: "none"`, `workers_dev: false`) and the
  assets directory resolves to `dist-marketing`;
- both pages answer 200 from `dist-marketing` while a stand-in origin answers 503, with the stylesheet
  inlined and no origin request made;
- `_headers` carries the same security headers as the app.

The spec needs the build (`bun run build`); CI builds before it runs. It is not a browser test.
