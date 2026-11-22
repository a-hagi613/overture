import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const ACCESS_HEADER = "cf-access-jwt-assertion";
const ACCESS_COOKIE = "CF_Authorization";

const accessIdentitySchema = z.looseObject({
  email: z.string(),
  sub: z.string(),
});

export interface CloudflareAccessIdentity {
  email: string;
  sub: string;
}

export interface AccessVerifier {
  verify: (request: Request) => Promise<CloudflareAccessIdentity | null>;
}

export function accessJwksUrlFromEnv(jwksUrl: string | undefined, teamDomain: string | undefined) {
  if (jwksUrl !== undefined) {
    return new URL(jwksUrl);
  }

  if (teamDomain !== undefined) {
    return new URL(`https://${teamDomain}/cdn-cgi/access/certs`);
  }

  return null;
}

function tokenFromRequest(request: Request) {
  const header = request.headers.get(ACCESS_HEADER);

  if (header !== null && header.length > 0) {
    return header;
  }

  const cookie = request.headers.get("cookie");

  if (cookie === null) {
    return null;
  }

  const paired = cookie
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${ACCESS_COOKIE}=`));

  const value = paired?.slice(ACCESS_COOKIE.length + 1);

  if (value === undefined || value.length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The Cloudflare Access issuer for a team, or undefined when the deployment names only a JWKS URL.
 *
 * Building `https://undefined` from a missing team domain made every valid token fail closed with
 * 401 instead of accepting the configured team; a deployment without a team domain now verifies
 * the signature and audience against its JWKS URL and skips the issuer claim it cannot know.
 * @param teamDomain The Access team domain from `CF_ACCESS_TEAM_DOMAIN`.
 * @returns The issuer claim to verify, or undefined when the team domain is not configured.
 */
export function accessIssuer(teamDomain: string | undefined) {
  return teamDomain === undefined ? undefined : `https://${teamDomain}`;
}

export function createAccessVerifier(config: {
  jwksUrl: string | undefined;
  teamDomain: string | undefined;
  audience: string | undefined;
}) {
  const jwksUrl = accessJwksUrlFromEnv(config.jwksUrl, config.teamDomain);

  if (jwksUrl === null || config.audience === undefined) {
    return null;
  }

  const issuer = accessIssuer(config.teamDomain);
  const { audience } = config;
  const jwks = createRemoteJWKSet(jwksUrl);

  return {
    verify: async (request: Request) => {
      const token = tokenFromRequest(request);

      if (token === null) {
        return null;
      }

      try {
        const { payload } = await jwtVerify(
          token,
          jwks,
          issuer === undefined ? { audience } : { audience, issuer },
        );

        const parsed = accessIdentitySchema.safeParse(payload);

        return parsed.success ? { email: parsed.data.email, sub: parsed.data.sub } : null;
      } catch {
        return null;
      }
    },
  } satisfies AccessVerifier;
}
