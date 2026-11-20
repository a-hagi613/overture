import { Buffer } from "node:buffer";

import { authenticate } from "mailauth";
import type { DNSResolver } from "mailauth";

function alignedDomains(left: string, right: string) {
  const leftHost = left.trim().toLowerCase().replace(/\.$/u, "");
  const rightHost = right.trim().toLowerCase().replace(/\.$/u, "");

  return (
    leftHost === rightHost ||
    leftHost.endsWith(`.${rightHost}`) ||
    rightHost.endsWith(`.${leftHost}`)
  );
}

export async function inboundAuth(
  raw: Uint8Array<ArrayBuffer>,
  options: {
    resolver: DNSResolver;
    fromDomain: string;
    sender: string;
  },
) {
  const result = await authenticate(Buffer.from(raw), {
    sender: options.sender,
    resolver: options.resolver,
    disableArc: true,
    disableBimi: true,
  });

  const signatures = result.dkim.results;

  const passing = signatures.some(
    (signature) =>
      signature.status.result === "pass" &&
      signature.signingDomain !== undefined &&
      alignedDomains(signature.signingDomain, options.fromDomain),
  );

  if (passing) {
    return "pass";
  }

  const failing = signatures.some(
    (signature) =>
      signature.status.result === "fail" ||
      signature.status.result === "policy" ||
      signature.status.result === "permerror",
  );

  return failing ? "fail" : "none";
}
