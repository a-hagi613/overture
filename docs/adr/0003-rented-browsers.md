---
status: accepted
---

# Browsers are rented from Browser Use; our own code drives them

Applications are submitted in Browser Use Cloud browsers (residential proxy in the user's country, built-in challenge solving, one persistent profile per user), driven over CDP by our own Playwright form-filling engine behind a `BrowserProvider` port. Success rate and the headaches removed decided this over price. Kernel sits behind the same port as an emergency fallback only, exercised on the synthetic lab, because its acceptable-use policy bans bulk form submission.

## Considered Options

- Self-hosted headed Chrome plus our own residential proxy: cheaper per application, but 5–8 engineer-weeks plus upkeep, and we would still need a solver.
- Splitting the owner's real applications between Browser Use and Kernel for a bake-off: rejected because of Kernel's policy.
