---
status: accepted
---

# Factual answers come only from saved Facts

Every factual answer traces to a Fact the user saved or a Target the user set; Overture never generates one. Code may format, combine or choose between those values (a city, region and country answer; a US state answer from the saved city; countries from target locations), and the Snapshot records the derivation, but it may not add a fact the user did not give. The resume PDF is sent byte for byte and never regenerated. Cover letters and open-text answers are returned sentence by sentence with the resume lines that support each claim, and unsupported sentences are removed. Posting text is untrusted input: it passes the posting guard and never decides a factual answer. An unknown required factual question becomes a Review; an unknown optional one is left blank and never blocks.

The confirmed identity Facts answer their fields on every ATS, including when a board marks them optional and when its label is unreadable and only the control name is left. Citizenship and sponsorship Facts answer each other only when the value fits the country the question names, an English-speaking resume answers an English-fluency question Yes, and the confirmed current title picks a role-category option. None of these runs on an unconfirmed Fact.

An employer's unfilled template is not a question. Copy that still carries a `_____` blank, an "OPTIONAL TO INCLUDE" marker or another placeholder is left empty even when the board's own markup marks it required, and it never reaches Review.

## Considered Options

- Letting the model answer factual questions from context: fast, but the one mistake that cannot be taken back is a false statement in an application.
