export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const REFERRER_POLICY = "strict-origin-when-cross-origin";

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()";

const HSTS_MAX_AGE_SECONDS = 15_552_000;

export const STRICT_TRANSPORT_SECURITY = `max-age=${String(HSTS_MAX_AGE_SECONDS)}`;

/**
 * The headers the app sends on every response. The CSP is separate because a route may set its own
 * (the lab pages do), and the prerendered marketing build writes the complete set, CSP included, into
 * the Workers Static Assets `_headers` file, so the two paths cannot drift.
 */
export const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": REFERRER_POLICY,
  "X-Frame-Options": "DENY",
  "Permissions-Policy": PERMISSIONS_POLICY,
} as const;

export const STATIC_ASSET_SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  ...BASE_SECURITY_HEADERS,
  "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
} as const;
