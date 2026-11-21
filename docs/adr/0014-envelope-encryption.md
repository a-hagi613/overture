---
status: accepted
---

# Per-user envelope encryption and crypto-shredding

Each user has a data key wrapped under a Fly-secret master key; personal columns, resume files, mail bodies, attachments
and exports are encrypted under it. An export gets its own random key, wrapped under the user's data key, and the
archive is sealed with that export key; the key travels only in the download link's fragment. Deleting an account
deletes the wrapped key first, which makes every remaining copy unreadable, then cascades rows and objects. No
personal data reaches logs or traces.

## Considered Options

- Database-level encryption only: backups and replicas would still hold readable personal data after deletion.
