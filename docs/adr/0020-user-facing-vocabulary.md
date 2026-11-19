---
status: accepted
---

# Banned words are banned in anything a user can read

The words `Hold` (as a Stage), runner, lease, provider, dispatch, attempt, ledger, credit, CAPTCHA, Brain and Hands never appear in UI, copy, emails, push, error messages or the landing. Code uses the glossary for product concepts and may keep precise engineering names for internals (`ledger`, `attempts`, `dispatch`, `BrowserProvider`), because renaming them hides what they are.

## Considered Options

- Banning the words in identifiers too: forces vague names for exactly the parts that most need to be precise.
