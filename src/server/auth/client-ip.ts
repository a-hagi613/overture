import { isIP } from "node:net";

const flyClientIpHeader = "fly-client-ip";
const flyRequestIdHeader = "fly-request-id";
const forwardedForHeader = "x-forwarded-for";

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

export function clientIp(request: Request, config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    return stampedByFlyProxy(request) ? parsedIp(request.headers.get(flyClientIpHeader)) : null;
  }

  if (config.nodeEnv === "production") {
    return null;
  }

  return parsedIp(request.headers.get(forwardedForHeader)?.split(",")[0]);
}

export function clientIpHeaders(config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    return [flyClientIpHeader];
  }

  return config.nodeEnv === "production" ? [] : [forwardedForHeader];
}

export function stripUntrustedIpHeaders(request: Request, config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    if (!stampedByFlyProxy(request)) {
      request.headers.delete(flyClientIpHeader);
    }

    return request;
  }

  if (config.nodeEnv === "production") {
    request.headers.delete(flyClientIpHeader);
    request.headers.delete(forwardedForHeader);
  }

  return request;
}
