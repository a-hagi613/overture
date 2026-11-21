---
status: accepted (amended by ADR 0029: Ready and Approved statuses, the Ready Stage)
---

# Status and Stage are separate; email moves cards forward only

Status is where an Application stands inside Overture; Stage is where it stands with the employer. Couldn't apply, skipped and withdrawn are off the Board. Classified employer email may move a card forward (or to Closed on a rejection), with an undo, and never after the user dragged it by hand.

## Considered Options

- One combined state column (v1): conflated "waiting on Overture" with "waiting on the employer" and produced the Hold confusion.
