---
status: accepted
---

# Per-user envelope encryption and crypto-shredding

Each user has a data key wrapped under a Fly-secret master key; personal columns, resume files, mail bodies, attachments
and exports are encrypted under it. An export gets its own random key that the server generates and wraps under the
user's data key, and the archive is sealed with that export key. The key is never stored in plaintext or logged, and it
reaches the page only with the download link (in its fragment), so the archive is decrypted in the browser. Deleting an
account deletes the wrapped key first, which makes every remaining copy unreadable, then cascades rows and objects. No
personal data reaches logs or traces.

## Considered Options

- Database-level encryption only: backups and replicas would still hold readable personal data after deletion.
