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

  return value === undefined || value.length === 0 ? null : decodeURIComponent(value);
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

  const issuer = `https://${config.teamDomain}`;
  const { audience } = config;
  const jwks = createRemoteJWKSet(jwksUrl);

  return {
    verify: async (request: Request) => {
      const token = tokenFromRequest(request);

      if (token === null) {
        return null;
      }

      try {
        const { payload } = await jwtVerify(token, jwks, { issuer, audience });

        const parsed = accessIdentitySchema.safeParse(payload);

        return parsed.success ? { email: parsed.data.email, sub: parsed.data.sub } : null;
      } catch {
        return null;
      }
    },
  } satisfies AccessVerifier;
}
