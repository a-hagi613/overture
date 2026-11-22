import { Buffer } from "node:buffer";

import { authenticate } from "mailauth";
import type { DNSResolver } from "mailauth";

import { isSameHostOrSubdomain } from "../../shared/host-match.ts";

function alignedDomains(left: string, right: string) {
  return isSameHostOrSubdomain(left, right) || isSameHostOrSubdomain(right, left);
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
