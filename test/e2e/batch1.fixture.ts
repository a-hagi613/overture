import { z } from "zod";

import { BATCH_1_ATS } from "../../src/shared/ats.ts";

export type Batch1Board = (typeof BATCH_1_ATS)[number];

const boardSchema = z.enum(BATCH_1_ATS);

export const formSchema = z.object({
  board: boardSchema,
  loginWall: z.boolean().default(false),
  mutate: z.boolean().default(false),
  extraRequired: z.boolean().default(false),
  portfolio: z.boolean().default(false),
});

type FormMode = z.infer<typeof formSchema>;

interface BoardSite {
  board: Batch1Board;
  /** The seeded board token. */
  boardToken: string;
  formId: string;
  /** The apply path the browser and the HTTP reader open. */
  path: string;
  /** The submitted field names the fixture records. */
  jobId: string;
}

export const BATCH1_SITES = [
  {
    board: "smartrecruiters",
    boardToken: "example",
    formId: "application-form",
    jobId: "744000012345678",
    path: "/example/744000012345678-platform-engineer",
  },
  {
    board: "paylocity",
    boardToken: "example",
    formId: "applicationForm",
    jobId: "9100001",
    path: "/Recruiting/Jobs/Apply/9100001",
  },
  {
    board: "manatal",
    boardToken: "example",
    formId: "application-form",
    jobId: "55001",
    path: "/example/jobs/55001",
  },
  {
    board: "careerplug",
    boardToken: "example",
    formId: "new_application",
    jobId: "77001",
    path: "/example/jobs/77001/applications/new",
  },
  {
    board: "jazzhr",
    boardToken: "example",
    formId: "application-form",
    jobId: "88001",
    path: "/example/apply/88001",
  },
] as const satisfies readonly BoardSite[];

export const BATCH1_COMPANY = "Example";
export const BATCH1_TITLE = "Platform Engineer";

const CONFIRMATION_HTML = `<!doctype html>
<html lang="en"><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>`;

const LOGIN_WALL_HTML = `<!doctype html>
<html lang="en">
<head><title>Sign in | ${BATCH1_COMPANY}</title></head>
<body>
<h1>Sign in</h1>
<p>You must sign in to continue.</p>
<form id="sign-in" method="post" action="/login">
  <label for="sign-in-email">Email</label>
  <input id="sign-in-email" name="email" type="email" required>
  <label for="sign-in-password">Password</label>
  <input id="sign-in-password" name="password" type="password" required>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`;

const mutationScript = (formId: string) => `<script>
  const form = document.querySelector("#${formId}");
  const resume = form.querySelector("input[type='file'][name='resume']");
  if (resume !== null) {
    resume.addEventListener("change", () => {
      form.querySelector("input[name='email']").value = "parser@example.com";
    });
  }
</script>`;

function applyPage(site: BoardSite, mode: FormMode) {
  const extra = mode.extraRequired
    ? `<label for="pronouns">Pronouns</label><input id="pronouns" name="pronouns" type="text" required>`
    : "";

  const portfolio = mode.portfolio
    ? `<label for="portfolio">Portfolio</label><input id="portfolio" name="portfolio" type="file" required>`
    : "";

  return `<!doctype html>
<html lang="en">
<head><title>${BATCH1_TITLE} at ${BATCH1_COMPANY}</title></head>
<body>
<form id="newsletter" method="post" action="/newsletter">
  <label for="newsletter-email">Email</label>
  <input id="newsletter-email" name="email" type="email">
  <button type="submit">Subscribe</button>
</form>
<form id="${site.formId}" method="post" action="${site.path}" enctype="multipart/form-data">
  <label for="first_name">First name</label>
  <input id="first_name" name="first_name" type="text" required>
  <label for="last_name">Last name</label>
  <input id="last_name" name="last_name" type="text" required>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="linkedin">LinkedIn</label>
  <input id="linkedin" name="linkedin" type="url">
  <label for="resume">Resume</label>
  <input id="resume" name="resume" type="file" required>
  ${extra}
  ${portfolio}
  <button type="submit">Submit application</button>
</form>
${mode.mutate ? mutationScript(site.formId) : ""}
</body>
</html>`;
}

export interface Batch1BoardState {
  formLoads: number;
  submissions: number;
  lastForm: Record<string, string>;
  files: { field: string; name: string }[];
}

interface ServedPost {
  fields: Record<string, string>;
  files: { field: string; name: string }[];
  path: string;
}

export interface Batch1Fixture {
  url: string;
  applyUrl: (board: Batch1Board) => string;
  state: (board: Batch1Board) => Batch1BoardState;
  posts: (board: Batch1Board) => ServedPost[];
  setMode: (mode: z.input<typeof formSchema>) => void;
  close: () => void;
}

const initialMode = (board: Batch1Board) => ({
  board,
  extraRequired: false,
  loginWall: false,
  mutate: false,
  portfolio: false,
});

const siteFor = (pathname: string) => BATCH1_SITES.find((site) => site.path === pathname) ?? null;

/**
 * Serves the five Batch 1 boards' apply pages from one deterministic server.
 * Each board has its own form id and path, so a decoy form and a board-specific
 * adapter can be told apart; the mode lets a test turn a page into a login gate,
 * a form that rewrites an approved answer, or a form with a new required field.
 *
 * @returns the fixture server, its per-board state, and the mode switch.
 */
export const startBatch1Fixture: () => Batch1Fixture = () => {
  const modes = new Map<Batch1Board, FormMode>(
    BATCH_1_ATS.map((board) => [board, initialMode(board)]),
  );

  const states = new Map<Batch1Board, Batch1BoardState>(
    BATCH_1_ATS.map((board) => [board, { files: [], formLoads: 0, lastForm: {}, submissions: 0 }]),
  );

  const posts = new Map<Batch1Board, ServedPost[]>(BATCH_1_ATS.map((board) => [board, []]));

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const site = siteFor(url.pathname);

      if (url.pathname === "/__fixture__/mode" && request.method === "POST") {
        const mode = formSchema.parse(await request.json());

        modes.set(mode.board, mode);

        return Response.json({ ok: true });
      }

      if (url.pathname === "/__fixture__/state") {
        const board = boardSchema.parse(url.searchParams.get("board"));

        return Response.json(states.get(board) ?? {});
      }

      if (site === null) {
        return new Response("not found", { status: 404 });
      }

      const mode = modes.get(site.board) ?? initialMode(site.board);
      const state = states.get(site.board);

      if (state === undefined) {
        return new Response("not found", { status: 404 });
      }

      if (request.method === "GET") {
        state.formLoads += 1;

        return new Response(mode.loginWall ? LOGIN_WALL_HTML : applyPage(site, mode), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      const type = request.headers.get("content-type") ?? "";
      const fields: Record<string, string> = {};
      const files: { field: string; name: string }[] = [];

      if (type.includes("multipart/form-data") || type.includes("x-www-form-urlencoded")) {
        for (const [name, value] of await request.formData()) {
          if (value instanceof File) {
            files.push({ field: name, name: value.name });
          } else {
            fields[name] = value;
          }
        }
      }

      state.submissions += 1;
      state.lastForm = fields;
      state.files = files;
      posts.get(site.board)?.push({ fields, files, path: url.pathname });

      return new Response(CONFIRMATION_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  const baseUrl = server.url.toString().replace(/\/$/u, "");

  return {
    url: baseUrl,
    applyUrl: (board) => {
      const site = BATCH1_SITES.find((candidate) => candidate.board === board);

      if (site === undefined) {
        throw new Error(`no fixture site for ${board}`);
      }

      return `${baseUrl}${site.path}`;
    },
    state: (board) => {
      const state = states.get(board);

      if (state === undefined) {
        throw new Error(`no fixture state for ${board}`);
      }

      return state;
    },
    posts: (board) => posts.get(board) ?? [],
    setMode: (mode) => {
      modes.set(mode.board, formSchema.parse(mode));
    },
    close: () => {
      void server.stop(true);
    },
  };
};
