---
status: accepted
---

# A same-origin SPA; marketing pages prerendered

The app is a Vite + React 19 single-page app with React Router 7 in library mode, served same-origin by the Hono server, with TanStack Query and a typed Hono RPC client; one SSE stream per tab carries updates. Public marketing and pricing pages are prerendered to static HTML.

## Considered Options

- An SSR framework: little value for a logged-in app.
- A pure SPA for marketing too: poor for search and first load.
