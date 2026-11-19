---
status: accepted
---

# Per-user envelope encryption and crypto-shredding

Each user has a data key wrapped under a Fly-secret master key; personal columns, resume files, mail bodies, attachments and exports are encrypted under it. Deleting an account deletes the wrapped key first, which makes every remaining copy unreadable, then cascades rows and objects. No personal data reaches logs or traces.

## Considered Options

- Database-level encryption only: backups and replicas would still hold readable personal data after deletion.
