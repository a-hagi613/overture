---
status: accepted (amended by ADR 0029: the user approves every send)
---

# Users never see a browser or solve a challenge

Overture is fully automatic up to the user's approval (ADR 0029, amended 2026-11-26: the user picks the jobs and approves every send). Prevention (stealth, residential IP, one profile per user), verification codes read from the job-search address, and the vendor's solver handle challenges; anything still blocked becomes "Couldn't apply", not charged, with one retry before Submit. The only thing a user is asked mid-pipeline is a Review. The admin can replay an attempt; users cannot. The admin live view was removed on 2026-11-26 (ADR 0046, SPEC §16.5): proof of a send is the before/after Submit screenshots and the application timeline.

## Considered Options

- A user-facing Live Tab (CDP screencast) for solving challenges: turns an automatic product into a chore and needs the user present.
