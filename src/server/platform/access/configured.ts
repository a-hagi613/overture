import { env } from "../../config/env.ts";
import { createAccessVerifier } from "./index.ts";

/**
 * The one Cloudflare Access verifier the admin host, its API and the admin-host
 * `/api/me` share, so a cold start fetches the team's JWKS once.
 */
export const accessVerifier = createAccessVerifier({
  audience: env.CF_ACCESS_AUD,
  jwksUrl: env.CF_ACCESS_JWKS_URL,
  teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
});
