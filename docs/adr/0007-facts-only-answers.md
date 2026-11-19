---
status: accepted
---

# Factual answers come only from saved Facts

Every factual answer traces to a Fact the user saved; Overture never generates one. The resume PDF is sent byte for byte and never regenerated. Cover letters and open-text answers are returned sentence by sentence with the resume lines that support each claim, and unsupported sentences are removed. Posting text is untrusted input: it passes the posting guard and never decides a factual answer. An unknown required factual question becomes a Review; an unknown optional one is left blank and never blocks.

## Considered Options

- Letting the model answer factual questions from context: fast, but the one mistake that cannot be taken back is a false statement in an application.
