export interface TrustedOriginConfig {
  appOrigin: string | undefined;
  adminOrigin: string | undefined;
  allowedHosts: readonly string[] | undefined;
}

export function trustedOriginsFor(config: TrustedOriginConfig) {
  const origins = [
    ...(config.appOrigin === undefined ? [] : [config.appOrigin]),
    ...(config.adminOrigin === undefined ? [] : [config.adminOrigin]),
    ...(config.allowedHosts === undefined
      ? []
      : config.allowedHosts.map((host) => `http://${host}:*`)),
  ];

  return [...new Set(origins)];
}
