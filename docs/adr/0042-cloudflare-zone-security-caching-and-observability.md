---
status: accepted
---

# Cloudflare Zone Security, Caching, DNS/Email & Observability Configuration

Records the free-tier Cloudflare zone configuration applied to `tryoverture.com` (and `admin.tryoverture.com`) on
2026-11-24 alongside ADR 0033 (`Cloudflare paid plan use and spend cap`) and ADR 0035 (`Passwordless auth`).

## Context

Newly provisioned domains appear immediately in public Certificate Transparency logs, attracting automated scanner
traffic (probing `.php`, `.env`, `.git`, `wp-admin`, `wp-login`, `/admin`, and `/api/auth/get-session`) from cloud hosts
worldwide. At the same time, automated health probes (`devbox-health`, Fly checks, and the Cloudflare Sentinel Worker)
poll `https://tryoverture.com/api/health`, and webhooks arrive at `/webhooks/stripe` and `/webhooks/inbound`.

To shed automated vulnerability noise at the Cloudflare edge at `$0` additional cost without breaking health checks,
webhooks, or dynamic application routes, the zone rules below were configured and live-verified.

## Decision

The `tryoverture.com` Cloudflare zone enforces the following configuration across four pillars:

### 1. WAF, Bot & Application Security

- **Browser Integrity Check (`Security → Settings`): ON** — inspects incoming HTTP headers to drop missing/spoofed
  User-Agent scanners at the edge before requests reach Fly.
- **Custom WAF Rule — `Block scanner probes` (`Security → Security rules`): Block** — filters vulnerability probes at
  the edge:
  ```text
  (http.request.uri.path contains ".php") or (http.request.uri.path contains ".env") or (http.request.uri.path contains ".git") or (http.request.uri.path contains "wp-admin") or (http.request.uri.path contains "wp-login")
  ```
- **Rate Limiting Rule — `Rate limit API` (`Security → Security rules`): Block (10s)** — caps incoming requests whose
  `URI Path starts with /api/` at **30 requests per 10 seconds per IP**, while leaving `/webhooks/stripe` and
  `/webhooks/inbound` unrestricted.
- **Leaked Credentials Check (`Security → Settings`): ON** — checks login submissions against known breached credential
  databases and sets the `Exposed-Credential-Check` header for backend awareness.
- **Cloudflare Turnstile (`Protect & connect → Turnstile`)**: live widget covering both `tryoverture.com` and
  `admin.tryoverture.com` with backend `siteverify` enforcement.
- **Cloudflare Access (`admin.tryoverture.com`)**: Zero Trust edge policy remains the sole outer gate on all admin
  pages and `/admin/api/*`.
- **Free Bot Fight Mode (`Security → Settings`): kept OFF** — Free Bot Fight Mode issues a JavaScript interstitial
  (`403 "Just a moment..."`) that blocks automated `curl`/`fetch` health checks (`/api/health`) and cron monitors.
  If bot mitigation beyond Browser Integrity Check and Custom WAF rules is ever needed later, use Super Bot Fight Mode
  (with explicit `/api/health` / probe exceptions) rather than toggling Free Bot Fight Mode back on globally.

### 2. Performance & Edge Caching

- **Smart Tiered Cache (`Caching → Tiered Cache`): Active** — routes cache misses through upper-tier Cloudflare POPs to
  cut origin load.
- **Custom Cache Rule — `Cache static assets` (`Caching → Cache Rules`): Eligible for cache** — caches static file
  extensions while explicitly excluding `/api/` and service worker paths (Overture serves its service worker at both `/sw`
  and `/sw.js`), paired with origin `CDN-Cache-Control` headers (`1 year immutable` for `/assets/*`, `30 days` +
  `stale-while-revalidate` and HTTP `206` byte-range streaming for `/videos/*`, and `7 days` for `/icons/*`,
  `/favicon.svg`, and `/manifest.webmanifest`):
  ```text
  (http.request.uri.path.extension in {"css" "js" "png" "jpg" "jpeg" "webp" "avif" "svg" "ico" "woff" "woff2" "mp4" "webm" "webmanifest"}) and not (starts_with(http.request.uri.path, "/api/")) and not (http.request.uri.path eq "/sw.js")
  ```
- **Early Hints (`Speed → Settings`): ON** — emits `103 Early Hints` for critical preloaded assets.

### 3. DNS, SSL/TLS & Email Security

- **DNSSEC (`DNS → Settings`): Enabled** — cryptographically signs `tryoverture.com` DNS records against spoofing and
  cache poisoning.
- **SSL/TLS Edge Certificates (`SSL/TLS → Edge Certificates`)**: hardened transport configuration (Always Use HTTPS and
  modern TLS).
- **DMARC Management (`Email → DMARC Management`): Enabled** — `DMARC policy: Reject`, `DKIM in use: Yes`, with
  Cloudflare's `rua` aggregate reporting DNS record collecting spoofing reports.

### 4. AI Governance & Observability

- **AI Crawl Control (`AI Crawl Control`): Enabled** — tracks and governs AI crawlers (`Googlebot`, `ClaudeBot`,
  `Perplexity-User`, `GPTBot`).
- **Real User Monitoring / Web Analytics (`Speed → Real user monitoring`): Active** — free, cookie-free Core Web Vitals
  and traffic telemetry (CSP permits `https://static.cloudflareinsights.com` and `https://cloudflareinsights.com`).
  - *Follow-up noted from initial RUM baseline:* inspect poster paint and edge byte-range caching on `/videos/*`.

## Consequences

- Automated `.env`, `.php`, `.git`, and WordPress vulnerability scans are dropped at the Cloudflare edge (`HTTP 403`)
  without touching the Fly origin, while `/api/health` (`HTTP 200`) and webhook endpoints stay reachable.
- Static assets under `/assets/*`, `/videos/*`, and `/icons/*` benefit from Smart Tiered Cache and free edge caching while API responses and service
  worker updates remain uncached.
- Keeping Free Bot Fight Mode **OFF** prevents self-inflicted monitoring outages (`403` on `/api/health` alerts).
