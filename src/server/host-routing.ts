import type { Context, Hono, Next } from "hono";

import { copy } from "../shared/copy.ts";
import { ADMIN_REFUSAL_CODES } from "./routes/admin-refusals.ts";

const ADMIN_ROOT_PATH = "/admin";

export function hostnameFromHeader(hostHeader: string | undefined) {
  if (hostHeader === undefined || hostHeader === "") {
    return "";
  }

  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return "";
  }
}

export function isAdminHost(hostname: string, adminOrigin: string) {
  try {
    return hostname === new URL(adminOrigin).hostname;
  } catch {
    return false;
  }
}

export function dispatchByHost(adminHost: Hono, adminOrigin: string) {
  return async (context: Context, next: Next) => {
    const hostname = hostnameFromHeader(context.req.header("host"));

    if (isAdminHost(hostname, adminOrigin)) {
      return adminHost.fetch(context.req.raw);
    }

    return next();
  };
}

export function mainHostAdminApiRefusal(context: Context) {
  return context.json({ error: ADMIN_REFUSAL_CODES.accessRequired }, 401);
}

/**
 * The admin host's front door: the portal lives at `/admin`, so a bare `/` goes there.
 * @param url The requested URL, whose query string is kept.
 * @returns The root-relative path the admin host redirects to.
 */
export function adminRootLocation(url: URL) {
  return `${ADMIN_ROOT_PATH}${url.search}`;
}

/**
 * Whether an admin-host request is a page a person opens, rather than an API call or an asset.
 * @param method The request method.
 * @param pathname The request path.
 * @param accept The request's `Accept` header.
 * @returns True for a browser navigation to an admin page.
 */
export function isAdminPageRequest(method: string, pathname: string, accept: string) {
  if (method !== "GET") {
    return false;
  }

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin/api/") ||
    pathname.startsWith("/__test__/")
  ) {
    return false;
  }

  return accept.includes("text/html");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The plain refusal a signed-in non-owner gets on the admin host.
 * @param ownerEmail The account the portal belongs to.
 * @returns A complete HTML page naming the owner account.
 */
export function adminOwnerRefusalPage(ownerEmail: string) {
  const title = escapeHtml(copy.admin.ownerRefusalTitle);
  const body = escapeHtml(copy.admin.ownerRefusalBody(ownerEmail));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex" />
    <title>${title} · ${escapeHtml(copy.app.name)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f3eee4;
        --card: #fbf8f2;
        --ink: #151311;
        --mut: #5e5850;
        --line: rgba(21, 19, 17, 0.14);
        --need: #8e3a2c;
        --needbg: #efd9d3;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #191714;
          --card: #221f1c;
          --ink: #f2ede4;
          --mut: #ada69b;
          --line: rgba(242, 237, 228, 0.14);
          --need: #e58a78;
          --needbg: #40261f;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
        place-items: center;
        background: var(--bg);
        color: var(--ink);
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.55;
      }
      main {
        width: 100%;
        max-width: 560px;
        padding: 32px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--card);
        box-shadow:
          0 1px 0 rgba(21, 19, 17, 0.1),
          0 12px 24px -18px rgba(21, 19, 17, 0.38);
      }
      .pill {
        display: inline-flex;
        padding: 4px 10px;
        border-radius: 999px;
        background: var(--needbg);
        color: var(--need);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      h1 {
        margin: 20px 0 0;
        font-family: "Instrument Serif", Newsreader, Georgia, serif;
        font-size: 32px;
        font-weight: 400;
        line-height: 1.05;
        letter-spacing: -0.005em;
      }
      p {
        margin: 12px 0 0;
        color: var(--mut);
        overflow-wrap: anywhere;
      }
      @media (min-width: 640px) {
        main {
          padding: 40px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <span class="pill">${escapeHtml(copy.admin.adminPill)}</span>
      <h1>${title}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>
`;
}
