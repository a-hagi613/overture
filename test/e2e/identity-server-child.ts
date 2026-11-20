import { createClock } from "../../src/server/platform/ports/clock.ts";
import { z } from "zod";

import type { IdentityPersona } from "./identity-persona.ts";

const personaSchema = z.object({
  sub: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  picture: z.string().nullable(),
});

const CODE_TTL_MS = 60_000;

interface IssuedCode {
  persona: IdentityPersona;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string | null;
  expiresAt: number;
}

interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  name: string;
  email: string;
  email_verified: boolean;
  nonce?: string;
  picture?: string;
}

function base64url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeIdToken(claims: IdTokenClaims) {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "none", typ: "JWT" })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));

  return `${header}.${payload}.`;
}

async function sha256Base64url(value: string) {
  const bytes = new TextEncoder().encode(value);

  return crypto.subtle.digest("SHA-256", bytes).then((digest) => base64url(new Uint8Array(digest)));
}

const clock = createClock();

let persona: IdentityPersona = {
  sub: "owner-sub",
  name: "Test Owner",
  email: "owner@example.com",
  emailVerified: true,
  picture: null,
};

const codes = new Map<string, IssuedCode>();

const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/_persona") {
      const body = personaSchema.parse(await request.json());

      persona = {
        sub: body.sub,
        name: body.name,
        email: body.email,
        emailVerified: body.emailVerified,
        picture: body.picture,
      };

      return Response.json({ ok: true });
    }

    if (pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: url.origin,
        authorization_endpoint: `${url.origin}/authorize`,
        token_endpoint: `${url.origin}/token`,
        userinfo_endpoint: `${url.origin}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: [],
        scopes_supported: ["openid", "profile", "email"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }

    if (pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");

      if (redirectUri === null || state === null) {
        return new Response("bad authorization request", { status: 400 });
      }

      const code = base64url(crypto.getRandomValues(new Uint8Array(24)));
      const forwarded = new URL(redirectUri);

      forwarded.searchParams.set("code", code);
      forwarded.searchParams.set("state", state);

      codes.set(code, {
        persona,
        clientId: url.searchParams.get("client_id") ?? "",
        redirectUri,
        codeChallenge: url.searchParams.get("code_challenge") ?? "",
        nonce: url.searchParams.get("nonce"),
        expiresAt: clock.now() + CODE_TTL_MS,
      });

      return Response.redirect(forwarded.toString(), 302);
    }

    if (pathname === "/token") {
      if (request.headers.get("content-type") !== "application/x-www-form-urlencoded") {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }

      const form = new URLSearchParams(await request.text());
      const code = form.get("code");
      const issued = code === null ? undefined : codes.get(code);

      if (code === null || issued === undefined || issued.expiresAt < clock.now()) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      codes.delete(code);

      const clientId = form.get("client_id");
      const redirectUri = form.get("redirect_uri");
      const codeVerifier = form.get("code_verifier");

      if (clientId !== issued.clientId || redirectUri !== issued.redirectUri) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      const challenge = await sha256Base64url(codeVerifier ?? "");

      if (issued.codeChallenge !== "" && challenge !== issued.codeChallenge) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      const now = Math.floor(clock.now() / 1000);

      const claims: IdTokenClaims = {
        iss: url.origin,
        sub: issued.persona.sub,
        aud: clientId,
        iat: now,
        exp: now + 3600,
        name: issued.persona.name,
        email: issued.persona.email,
        email_verified: issued.persona.emailVerified,
        ...(issued.nonce !== null && { nonce: issued.nonce }),
        ...(issued.persona.picture !== null && { picture: issued.persona.picture }),
      };

      return Response.json({
        access_token: base64url(crypto.getRandomValues(new Uint8Array(24))),
        token_type: "Bearer",
        expires_in: 3600,
        id_token: encodeIdToken(claims),
      });
    }

    if (pathname === "/userinfo") {
      const accessToken = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";

      if (accessToken === "") {
        return Response.json({ error: "invalid_token" }, { status: 401 });
      }

      return Response.json({
        sub: persona.sub,
        name: persona.name,
        email: persona.email,
        email_verified: persona.emailVerified,
        ...(persona.picture !== null && { picture: persona.picture }),
      });
    }

    return new Response("not found", { status: 404 });
  },
});

process.stdout.write(`identity listening on ${String(server.port)}\n`);

process.on("SIGTERM", () => {
  void server.stop(true);
  process.exit(0);
});
