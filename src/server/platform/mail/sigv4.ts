import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "ses";
const CONTENT_TYPE = "application/json";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SesSignatureInput {
  host: string;
  path: string;
  body: string;
  region: string;
  now: number;
  credentials: AwsCredentials;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function amzDate(now: number) {
  return new Date(now)
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}/u, "");
}

export function signSesPost(input: SesSignatureInput) {
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalHeaders = [
    `content-type:${CONTENT_TYPE}`,
    `host:${input.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${date}`,
    "",
  ].join("\n");

  const canonicalRequest = [
    "POST",
    input.path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), SERVICE),
    "aws4_request",
  );

  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const headers = {
    authorization: `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "content-type": CONTENT_TYPE,
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };

  return headers;
}
