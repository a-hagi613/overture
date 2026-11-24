---
status: accepted
---

# Admin is a separate host; personal data needs a time-boxed, audited Reveal

The admin lives on `admin.tryoverture.com` behind Cloudflare Access and the single `OWNER_EMAIL` account. A verified Access JWT is the only admin gate: the admin host, `/admin/api/*`, the admin-host `/api/me` and Reveal all resolve the owner directly from that identity, with no secondary magic-link session and no passkey assertion. A non-owner or suspended identity gets `owner_required` (JSON from the API, the refusal page for a browser navigation), and a missing or invalid Access credential fails closed with `access_required`. User metadata is visible; resumes, Facts, mail and Snapshots need a Reveal: typed reason, 15 minutes, one user, read-only, audited off-box and shown to the user under "Support access". EEO answers are shown only in aggregate; card data never.

## Considered Options

- Command-line-only support: too slow for real support work.
- Full visibility without Reveal: no accountability for looking at a person's job search.
