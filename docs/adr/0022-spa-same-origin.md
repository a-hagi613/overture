---
status: accepted
---

# A same-origin SPA; marketing pages prerendered

The app is a Vite + React 19 single-page app with React Router 8 in library mode, served same-origin by the Hono server, with TanStack Query and `fetch` clients that parse each response with a Zod schema; one SSE stream per tab carries updates. Public marketing and pricing pages are prerendered to static HTML.

## Considered Options

- An SSR framework: little value for a logged-in app.
- A pure SPA for marketing too: poor for search and first load.

## Update: the prerendered pages are served from Workers Static Assets

From #284 (ADR 0033), Cloudflare serves the prerendered `/` and `/pricing` pages as Workers Static Assets
(`workers/marketing`), attached to explicit routes for those paths only. The app, the API and the app's own
assets keep coming from the Hono server on Fly and match no Worker route. The origin, the client-side router
and the hydration path are unchanged: a signed-in visitor at `/` still gets the app home once the JS bundle
loads. The only change is which edge answers the two marketing paths.

