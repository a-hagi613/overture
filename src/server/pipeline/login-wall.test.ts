import { describe, expect, test } from "bun:test";

import type { LoginWallInput } from "./login-wall.ts";

import { failedReasonText } from "../../shared/copy.ts";
import { createPlainFormReader, isLoginWallRead } from "./form-read.ts";
import { detectLoginWall, LOGIN_WALL_REASON } from "./login-wall.ts";

const APPLY_URL = "https://jobs.example.com/jobs/9f2/apply";

const GUEST_FORM = `<form id="application-form" action="/jobs/9f2/apply" method="post" enctype="multipart/form-data">
  <label>Resume/CV <input type="file" name="resume" required /></label>
  <label>Full name <input type="text" name="name" required /></label>
  <label>Email <input type="email" name="email" required /></label>
  <label>Phone <input type="tel" name="phone" required /></label>
  <button type="submit">Submit application</button>
</form>`;

const SIGN_IN_BOX = `<aside class="sign-in">
  <p>Sign in to autofill your application</p>
  <form action="/session"><input type="email" name="email" /><input type="password" name="password" /></form>
</aside>`;

const MANDATORY_SIGN_IN_PAGE = `<!doctype html>
<html><body><main>
  <h1>Sign in to continue</h1>
  <p>You must sign in to apply for this role.</p>
  <form action="/session" method="post">
    <label>Email <input type="email" name="email" /></label>
    <label>Password <input type="password" name="password" /></label>
    <button type="submit">Sign in</button>
  </form>
</main></body></html>`;

function evidenceFor(input: LoginWallInput) {
  const verdict = detectLoginWall(input);

  return verdict.wall ? verdict.evidence : null;
}

describe("the login-wall pre-flight", () => {
  test("names the reason preparation writes and Home shows", () => {
    expect(LOGIN_WALL_REASON).toBe("unsupported_login_required");
    expect(failedReasonText(LOGIN_WALL_REASON)).toContain("account");
  });

  test("skips a page that only offers an account sign-in", () => {
    expect(evidenceFor({ html: MANDATORY_SIGN_IN_PAGE, requestedUrl: APPLY_URL })).toEqual({
      markers: ["sign_in_copy", "password_field", "sign_in_form"],
      signals: ["gate"],
      url: APPLY_URL,
    });
  });

  test("skips a registration gate that asks for a name, an email and a password", () => {
    const html = `<html><body>
      <h1>Create an account to apply</h1>
      <form action="/register" method="post">
        <input type="text" name="first_name" />
        <input type="text" name="last_name" />
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button type="submit">Create account</button>
      </form>
    </body></html>`;

    expect(evidenceFor({ html, requestedUrl: APPLY_URL })).toEqual({
      markers: ["sign_in_copy", "password_field"],
      signals: ["gate"],
      url: APPLY_URL,
    });
  });

  test("skips a page that is a password box with no application form", () => {
    const html = `<html><body><form action="/candidate-portal" method="post">
      <input type="password" name="passcode" />
    </form></body></html>`;

    expect(evidenceFor({ html, requestedUrl: APPLY_URL })).toEqual({
      markers: ["password_field"],
      signals: ["gate"],
      url: APPLY_URL,
    });
  });

  test("follows a redirect to a sign-in path and says so", () => {
    expect(
      evidenceFor({
        finalUrl: "https://jobs.example.com/Login.aspx?ReturnUrl=%2Fjobs%2F9f2%2Fapply",
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({
      markers: ["redirect_path"],
      signals: ["redirect"],
      url: "https://jobs.example.com/Login.aspx?ReturnUrl=%2Fjobs%2F9f2%2Fapply",
    });

    expect(
      evidenceFor({
        finalUrl: "https://jobs.example.com/login/",
        requestedUrl: APPLY_URL,
      }),
    ).toMatchObject({ markers: ["redirect_path"] });
  });

  test("follows a redirect to a registration path", () => {
    expect(
      evidenceFor({
        finalUrl: "https://jobs.example.com/register?job=9f2",
        requestedUrl: APPLY_URL,
      }),
    ).toMatchObject({ markers: ["registration_path"], signals: ["redirect"] });
  });

  test("follows a redirect to an identity provider", () => {
    expect(
      evidenceFor({
        finalUrl: "https://acme.okta.com/app/UserHome",
        requestedUrl: APPLY_URL,
      }),
    ).toMatchObject({ markers: ["identity_provider"], signals: ["redirect"] });

    expect(
      evidenceFor({
        finalUrl: "https://sso.example.com/",
        requestedUrl: APPLY_URL,
      }),
    ).toMatchObject({ markers: ["identity_provider"], signals: ["redirect"] });
  });

  test("follows a redirect that only adds a login query", () => {
    expect(
      evidenceFor({
        finalUrl: "https://jobs.example.com/jobs/9f2/apply?action=login",
        requestedUrl: APPLY_URL,
      }),
    ).toMatchObject({ markers: ["login_query"], signals: ["redirect"] });
  });

  test("names both the redirect and the page when both are gated", () => {
    expect(
      evidenceFor({
        finalUrl: "https://jobs.example.com/login",
        html: MANDATORY_SIGN_IN_PAGE,
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({
      markers: ["redirect_path", "sign_in_copy", "password_field", "sign_in_form"],
      signals: ["redirect", "gate"],
      url: "https://jobs.example.com/login",
    });
  });

  test("ignores a redirect that lands on another page of the same form", () => {
    expect(
      detectLoginWall({
        finalUrl: "https://jobs.example.com/jobs/9f2/apply/step-2",
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({ wall: false });
  });

  test("ignores tracking parameters added around the same page", () => {
    expect(
      detectLoginWall({
        finalUrl: "https://jobs.example.com/jobs/9f2/apply?utm_source=feed",
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({ wall: false });
  });

  test("does not read a login URL the caller itself asked for as a redirect", () => {
    expect(
      detectLoginWall({
        finalUrl: "https://jobs.example.com/login",
        requestedUrl: "https://jobs.example.com/login",
      }),
    ).toEqual({ wall: false });
  });

  test("ignores an employer path that merely contains a login word", () => {
    expect(
      detectLoginWall({
        finalUrl: "https://jobs.example.com/login-inc/jobs/9f2",
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({ wall: false });

    expect(
      detectLoginWall({
        finalUrl: "https://jobs.example.com/authors/jane",
        requestedUrl: APPLY_URL,
      }),
    ).toEqual({ wall: false });
  });

  test("never skips a page with an active guest application form", () => {
    const html = `<html><body><main>
      <h2>Sign in to apply faster</h2>
      ${GUEST_FORM}
      ${SIGN_IN_BOX}
      <a href="https://www.linkedin.com/jobs/apply">Apply with LinkedIn</a>
    </main></body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("keeps the guest form when the page also carries sign-in copy", () => {
    const html = `<html><body>
      <p>Sign in to apply faster next time</p>
      ${GUEST_FORM}
    </body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("skips a credentialed form that asks for a name and an email", () => {
    const html = `<html><body><form action="/candidate-portal" method="post">
      <input type="text" name="first_name" />
      <input type="email" name="email" />
      <input type="password" name="password" />
    </form></body></html>`;

    expect(evidenceFor({ html, requestedUrl: APPLY_URL })).toEqual({
      markers: ["password_field"],
      signals: ["gate"],
      url: APPLY_URL,
    });
  });

  test("does not skip an optional autofill banner beside a guest form", () => {
    const html = `<html><body>
      <p>Sign in to autofill your application</p>
      ${GUEST_FORM}
    </body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("does not skip an optional autofill box that has no application form", () => {
    const html = `<html><body>
      <p>Sign in to autofill your application</p>
      ${SIGN_IN_BOX}
    </body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("does not skip a page that only offers social apply buttons", () => {
    const html = `<html><body><h1>Senior Product Designer</h1>
      <button>Apply with LinkedIn</button>
      <button>Apply with Indeed</button>
    </body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("does not read sign-in copy that only exists inside a script", () => {
    const html = `<html><body>
      <script>document.title = "You must sign in to apply";</script>
      <p>Applications for this role are reviewed weekly.</p>
    </body></html>`;

    expect(detectLoginWall({ html, requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("does not skip a page with no evidence at all", () => {
    expect(detectLoginWall({ requestedUrl: APPLY_URL })).toEqual({ wall: false });
    expect(detectLoginWall({ html: "   ", requestedUrl: APPLY_URL })).toEqual({ wall: false });
  });

  test("reports a plain Lever read that lands on a sign-in page", async () => {
    const reader = createPlainFormReader({
      fetcher: async () =>
        await Promise.resolve(
          new Response(MANDATORY_SIGN_IN_PAGE, { headers: { "content-type": "text/html" } }),
        ),
      leverBaseUrl: "https://jobs.example.com",
    });

    const read = await reader.read({
      applyUrl: null,
      ats: "lever",
      atsJobId: "9f2",
      boardToken: "acme",
      region: "us",
      url: "https://jobs.example.com/acme/9f2",
    });

    expect(isLoginWallRead(read)).toBe(true);
    expect(isLoginWallRead(read) ? read.evidence.markers : []).toEqual([
      "sign_in_copy",
      "password_field",
      "sign_in_form",
    ]);
  });
});
