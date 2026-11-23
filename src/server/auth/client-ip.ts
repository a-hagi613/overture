import { isIP } from "node:net";

const cfConnectingIpHeader = "cf-connecting-ip";
const flyClientIpHeader = "fly-client-ip";
const flyRequestIdHeader = "fly-request-id";
const forwardedForHeader = "x-forwarded-for";

const cloudflareIpv4Ranges = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

const cloudflareIpv6Ranges = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

interface Ipv4Range {
  readonly base: number;
  readonly prefix: number;
}

interface Ipv6Range {
  readonly base: bigint;
  readonly prefix: number;
}

export interface ClientIpConfig {
  flyAppName: string | undefined;
  nodeEnv: "development" | "test" | "production";
}

function stampedByFlyProxy(request: Request) {
  const requestId = request.headers.get(flyRequestIdHeader)?.trim();

  return requestId !== undefined && requestId !== "";
}

function parsedIp(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed !== undefined && trimmed !== "" && isIP(trimmed) !== 0 ? trimmed : null;
}

function ipv4Value(ip: string) {
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value;
}

function hexGroups(text: string) {
  if (text === "") {
    return [];
  }

  const groups: number[] = [];

  for (const group of text.split(":")) {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) {
      return null;
    }

    groups.push(Number.parseInt(group, 16));
  }

  return groups;
}

function ipv6Value(ip: string) {
  let head = ip;
  const tail: number[] = [];
  const ipv4Tail = /^(?<head>.*:)(?<address>\d{1,3}(?:\.\d{1,3}){3})$/u.exec(ip);
  const headPart = ipv4Tail?.groups?.head ?? "";
  const address = ipv4Tail?.groups?.address ?? "";

  if (headPart !== "" && address !== "") {
    const value = ipv4Value(address);

    if (value === null) {
      return null;
    }

    tail.push(Math.trunc(value / 65_536), value % 65_536);
    head = headPart.slice(0, -1);
  }

  const halves = head.split("::");

  if (halves.length > 2) {
    return null;
  }

  const left = hexGroups(halves[0] ?? "");
  const right = halves.length === 2 ? hexGroups(halves[1] ?? "") : [];

  if (left === null || right === null) {
    return null;
  }

  const missing = 8 - left.length - right.length - tail.length;

  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }

  const groups = [...left, ...Array.from({ length: missing }, () => 0), ...right, ...tail];

  if (groups.length !== 8) {
    return null;
  }

  let value = 0n;

  for (const group of groups) {
    value = value * 65_536n + BigInt(group);
  }

  return value;
}

function cidrParts(range: string) {
  const slash = range.indexOf("/");

  if (slash === -1) {
    return null;
  }

  const prefix = Number(range.slice(slash + 1));

  if (!Number.isInteger(prefix)) {
    return null;
  }

  return { address: range.slice(0, slash), prefix };
}

function ipv4Range(range: string) {
  const parts = cidrParts(range);

  if (parts === null) {
    return null;
  }

  const base = ipv4Value(parts.address);

  return base !== null && parts.prefix >= 0 && parts.prefix <= 32
    ? { base, prefix: parts.prefix }
    : null;
}

function ipv6Range(range: string) {
  const parts = cidrParts(range);

  if (parts === null) {
    return null;
  }

  const base = ipv6Value(parts.address);

  return base !== null && parts.prefix >= 0 && parts.prefix <= 128
    ? { base, prefix: parts.prefix }
    : null;
}

function ipv4Ranges(ranges: readonly string[]) {
  const parsed: Ipv4Range[] = [];

  for (const range of ranges) {
    const value = ipv4Range(range);

    if (value !== null) {
      parsed.push(value);
    }
  }

  return parsed;
}

function ipv6Ranges(ranges: readonly string[]) {
  const parsed: Ipv6Range[] = [];

  for (const range of ranges) {
    const value = ipv6Range(range);

    if (value !== null) {
      parsed.push(value);
    }
  }

  return parsed;
}

const cloudflareV4 = ipv4Ranges(cloudflareIpv4Ranges);
const cloudflareV6 = ipv6Ranges(cloudflareIpv6Ranges);

function ipv4InRange(value: number, range: Ipv4Range) {
  const size = 2 ** (32 - range.prefix);

  return Math.trunc(value / size) === Math.trunc(range.base / size);
}

function ipv6InRange(value: bigint, range: Ipv6Range) {
  const size = 2n ** BigInt(128 - range.prefix);

  return value / size === range.base / size;
}

function mappedIpv4(value: bigint) {
  return value / 4_294_967_296n === 65_535n ? Number(value % 4_294_967_296n) : null;
}

export function isCloudflareIp(ip: string) {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4Value(ip);

    return value !== null && cloudflareV4.some((range) => ipv4InRange(value, range));
  }

  if (version === 6) {
    const value = ipv6Value(ip);

    if (value === null) {
      return false;
    }

    const mapped = mappedIpv4(value);

    if (mapped === null) {
      return cloudflareV6.some((range) => ipv6InRange(value, range));
    }

    return cloudflareV4.some((range) => ipv4InRange(mapped, range));
  }

  return false;
}

function forwardedIp(request: Request) {
  return parsedIp(request.headers.get(forwardedForHeader)?.split(",")[0]);
}

export function clientIp(request: Request, config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    const flyIp = stampedByFlyProxy(request)
      ? parsedIp(request.headers.get(flyClientIpHeader))
      : null;

    if (flyIp === null) {
      return null;
    }

    if (isCloudflareIp(flyIp)) {
      return parsedIp(request.headers.get(cfConnectingIpHeader)) ?? flyIp;
    }

    return flyIp;
  }

  if (config.nodeEnv === "production") {
    return null;
  }

  return forwardedIp(request);
}

export function clientIpHeaders(config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    return [cfConnectingIpHeader, flyClientIpHeader];
  }

  return config.nodeEnv === "production" ? [] : [forwardedForHeader];
}

export function stripUntrustedIpHeaders(request: Request, config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    if (stampedByFlyProxy(request)) {
      const flyIp = parsedIp(request.headers.get(flyClientIpHeader));
      const cloudflareEdge = flyIp !== null && isCloudflareIp(flyIp);

      if (cloudflareEdge) {
        return request;
      }

      request.headers.delete(cfConnectingIpHeader);

      return request;
    }

    request.headers.delete(flyClientIpHeader);
    request.headers.delete(cfConnectingIpHeader);

    return request;
  }

  if (config.nodeEnv === "production") {
    request.headers.delete(flyClientIpHeader);
    request.headers.delete(cfConnectingIpHeader);
    request.headers.delete(forwardedForHeader);
  }

  return request;
}
