const flyClientIpHeader = "fly-client-ip";
const flyRequestIdHeader = "fly-request-id";

export interface ClientIpConfig {
  flyAppName: string | undefined;
  nodeEnv: "development" | "test" | "production";
}

export function clientIp(request: Request, config: ClientIpConfig) {
  if (config.flyAppName !== undefined) {
    if (request.headers.get(flyRequestIdHeader) === null) {
      return null;
    }

    const value = request.headers.get(flyClientIpHeader)?.trim();

    return value === undefined || value === "" ? null : value;
  }

  if (config.nodeEnv === "production") {
    return null;
  }

  const value = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return value === undefined || value === "" ? null : value;
}

export function clientIpHeaders(config: ClientIpConfig) {
  return config.flyAppName === undefined ? ["x-forwarded-for"] : [flyClientIpHeader];
}
