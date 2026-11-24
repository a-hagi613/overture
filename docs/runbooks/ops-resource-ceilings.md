# Runbook: Overture resource ceilings

**Means:** the sentinel's signed `GET /internal/ops/health` answer crossed a ceiling — RAM above
80 %, NVMe `/data` above 75 %, event-loop lag p95 above 500 ms, or ATS apply failures above 30 % of
at least five attempts in the last hour. The alert body names every breach it saw.

**First check:** open the "Overture production" dashboard in `fly-metrics.net` and read the matching
row (Fly System Resources, Runtime & Catalog, or Apply & ATS Health). Then re-read the signed answer
from a machine with the secret:

```sh
ts=$(date +%s%3N)
sig=$(printf 'GET\n/internal/ops/health\n%s' "$ts" | openssl dgst -sha256 -hmac "$OPS_HEALTH_SECRET" -hex | sed 's/^.* //')
curl -sS https://tryoverture.com/internal/ops/health \
  -H "x-overture-ops-timestamp: $ts" -H "x-overture-ops-signature: $sig"
```

**Then:**

- **RAM:** check the job classes in the admin health view; a catalog sweep or many concurrent
  browser sessions is the usual cause. Let the queue drain before adding work.
- **NVMe `/data`:** `fly ssh console -a overture-web -C 'du -sh /data/*'`. Object-store staging
  files and Litestream WALs are the usual growth; retention runs hourly.
- **Event-loop lag:** see which job/log storm lines up with the spike; a blocking
  `gunzipSync`/large JSON parse is the usual cause.
- **ATS failures:** check the ATS kill switches and the employer's apply URL. A single broken ATS
  should be paused rather than retried.

**Escalate to:** the owner (single-operator deployment). This alert repeats at most every six hours
while the condition holds and sends one recovery note when every ceiling is clear.
