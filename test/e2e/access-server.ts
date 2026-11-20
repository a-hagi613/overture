import { createServer } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";

const listenAddressSchema = z.object({ port: z.number() });

const accessTeamIdentity = {
  audience: "e2e-admin-audience",
  teamDomain: "e2e-team.cloudflareaccess.com",
};

interface AccessServer {
  url: string;
  issueToken: (claims: {
    audience?: string;
    email?: string;
    expiresIn?: string;
    issuer?: string;
  }) => Promise<string>;
  stop: () => Promise<void>;
}

export { accessTeamIdentity };

export type { AccessServer };

export async function startAccessServer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const keyId = "e2e-access-key-1";
  const jwks = { keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }] };

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(jwks));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const boundAddress = listenAddressSchema.parse(server.address());

  return {
    url: `http://127.0.0.1:${String(boundAddress.port)}`,
    issueToken: async (claims) => {
      const token = await new SignJWT({ email: claims.email ?? "owner@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "JWT" })
        .setSubject("e2e-access-identity")
        .setIssuer(claims.issuer ?? `https://${accessTeamIdentity.teamDomain}`)
        .setAudience(claims.audience ?? accessTeamIdentity.audience)
        .setIssuedAt()
        .setExpirationTime(claims.expiresIn ?? "5m")
        .sign(privateKey);

      return token;
    },
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  } satisfies AccessServer;
}
