import { generateKeyPairSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const UNCOMPRESSED_POINT_PREFIX = 0x04;

export interface VapidKeyPair {
  /** base64url-encoded 65-byte uncompressed P-256 point, as web-push's coordinateJwk expects. */
  publicKey: string;
  /** base64url-encoded 32-byte private scalar, as web-push's coordinateJwk expects. */
  privateKey: string;
}

export function generateVapidKeyPair() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });

  if (jwk.d === undefined || jwk.x === undefined || jwk.y === undefined) {
    throw new Error("The generated VAPID key pair is incomplete.");
  }

  const publicKey = Buffer.concat([
    Buffer.from([UNCOMPRESSED_POINT_PREFIX]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);

  const rawPrivateKey = Buffer.from(jwk.d, "base64url");

  if (publicKey.byteLength !== PUBLIC_KEY_BYTES || publicKey[0] !== UNCOMPRESSED_POINT_PREFIX) {
    throw new Error("The generated VAPID public key is not a 65-byte uncompressed P-256 point.");
  }

  if (rawPrivateKey.byteLength !== PRIVATE_KEY_BYTES) {
    throw new Error("The generated VAPID private key is not a 32-byte P-256 scalar.");
  }

  return {
    publicKey: publicKey.toString("base64url"),
    privateKey: rawPrivateKey.toString("base64url"),
  } satisfies VapidKeyPair;
}

function writeEnvFile(path: string, keys: VapidKeyPair) {
  writeFileSync(
    path,
    `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}

function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: { "out-env": { type: "string" } },
    strict: true,
  });

  const outEnv = args.values["out-env"];

  if (outEnv === undefined || outEnv === "") {
    process.stderr.write("usage: bun run scripts/generate-vapid.ts --out-env <env-file>\n");
    process.exitCode = 1;

    return;
  }

  writeEnvFile(outEnv, generateVapidKeyPair());
  process.stdout.write("Generated VAPID P-256 keypair (public key written to out-env).\n");
}

if (import.meta.main) {
  main();
}
