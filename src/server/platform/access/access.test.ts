import { describe, expect, test } from "bun:test";

import { accessIssuer, createAccessVerifier } from "./index.ts";

const audience = "overture-admin-audience";
const teamDomain = "overture.cloudflareaccess.com";
const jwksUrl = "https://overture.cloudflareaccess.com/cdn-cgi/access/certs";

function verifierFor(overrides: { teamDomain?: string | undefined } = {}) {
  return createAccessVerifier({
    audience,
    jwksUrl,
    teamDomain: "teamDomain" in overrides ? overrides.teamDomain : teamDomain,
  });
}

describe("the Cloudflare Access verifier", () => {
  test("fails closed on a cookie that is not valid percent-encoding", async () => {
    const verifier = verifierFor();

    if (verifier === null) {
      throw new Error("the verifier should be configured");
    }

    const request = new Request("https://admin.example.com/admin/api/overview", {
      headers: { cookie: "CF_Authorization=%E0%A4%A" },
    });

    expect(await verifier.verify(request)).toBeNull();
  });

  test("fails closed on a token that is not a JWT", async () => {
    const verifier = verifierFor();

    if (verifier === null) {
      throw new Error("the verifier should be configured");
    }

    const request = new Request("https://admin.example.com/admin/api/overview", {
      headers: { cookie: "CF_Authorization=not-a-token" },
    });

    expect(await verifier.verify(request)).toBeNull();
  });

  test("does not invent an issuer from a missing team domain", () => {
    expect(accessIssuer(teamDomain)).toBe(`https://${teamDomain}`);
    expect(accessIssuer(undefined)).toBeUndefined();
  });
});
