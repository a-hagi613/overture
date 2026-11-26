---
status: accepted
---

# AI provider: Claude Haiku 5.5 with structured outputs and the Message Batches API

The 2026-11-26 rebuild (Epic #678, written down by #679). It replaces the planned "AI provider: Gemini" ADR, which is
dropped, and it records one model for every AI task in Overture.

## Context

The product calls a model in six places: the match score, drafted open-text answers, cover letters, reading a resume,
mapping an application question to a saved fact, and classifying employer mail when the rules are unsure. Two models
across those calls would mean two prompt styles, two price sheets, two failure modes and two ways to validate an
answer. The local end-to-end run of 2026-11-26 also showed the cost and latency that matter: scoring is the volume
call (hundreds of jobs at onboarding, dozens a day later), while the resume read is one call a person waits on.

The owner's rule (2026-11-26): **Claude Haiku 5.5 for every AI task**, with the Message Batches API wherever the result
is not needed live, and every answer a structured output that code validates.

## Decision

1. **One model.** `claude-haiku-5-5` is the model for every AI task, through `LlmPort`. There is no second provider, no
   per-user key and no model choice at runtime. The Anthropic adapter is the only one; tests intercept its API with the
   test interceptor (ADR 0013).
2. **Structured output is the contract.** Every call sends a JSON schema through `output_config.format`, and the same
   zod schema validates the reply before anything is stored. **An invalid reply gets exactly one retry and is then
   rejected**: nothing is stored as free text, and the rejection is counted (the admin's AI rejection-rate alert).
   A rejected score leaves the job unscored rather than showing a made-up number.
3. **Batch wherever the result is not needed live.** The Message Batches API (50 % cheaper) carries the 3-hourly
   new-job scoring for paid users, mail classification and any rescore that is not a person waiting. **Live** calls are
   the onboarding score, a score on a filter change, the resume read, question mapping, open text and cover letters —
   the person is waiting on those.
4. **One job per call for the score.** Scoring jobs in groups of ten changed a job's score by 10–12 points on average
   in the 2026-11-25 test, so a score is computed alone. Scoring still sits behind a batch when nobody is waiting.
   (ADR 0045 owns the prompt, schema and sort.)
5. **Caching and effort.** The resume and the rubric/system prompt go first, so Anthropic's implicit caching covers
   them; Haiku 5.5's cache minimum is 512 tokens. Thinking is disabled with `effort: "low"` except cover letters
   (`effort: "medium"`). No PII in telemetry: prompts and replies are never logged, and the attribute allowlist in
   `platform/telemetry/otel.ts` drops anything outside it.
6. **Idempotent batches.** A batch is recorded in `llm_batches` before its id exists, keyed by the sha256 of the model
   and the request set, submitted with that hash as `Idempotency-Key`, polled by `llm.batch_poll`, and its results
   claimed by one conditional update, so a restart or a crash never bills the same requests twice (§8.6).
7. **Budgets fail closed.** The onboarding matching budget is $0.50 once, a user's daily AI budget is $0.10, and the
   global base is $50 a day plus $0.30 per paying subscriber, with the owner alerted at 80 %. A call over budget fails
   closed; preparation waits and scoring pauses to the next UTC day. There is no tagging budget, because there is no AI
   tagging.
8. **No real money outside real user activity** (#680). Freehire, Anthropic and Browser Use are faked in tests, CI and
   scheduled jobs; only a real user's matching or approved send spends.

## Consequences

- The prompts, their versions and their schemas are code; a prompt change bumps the version that is part of the cache
  key and the stored `scorer_version`.
- A schema miss is visible: it is counted, alerted on, and it leaves the job or the answer in a known state rather than
  a partial one.
- The resume read replaces the old line-pattern parser and the PDF fallback: one call returns every field, and code
  drops any value that is not literally in the resume text (#701, §7.2).
- Cost is per purpose in `llm_usage`, so cost per sent application (§16.5) can include the app's own model spend.
- Dropping the second provider removes its schema, its Batch tagging job and its location tagging (#683, #706).

## Considered Options

- **Two models (a cheap one for scoring, a stronger one for prose).** Rejected: the 2026-11-25 eval showed Haiku 5.5
  meets the score gate, and two providers double the prompt and failure surface for a measured saving of cents.
- **Free-text replies parsed by regex.** Rejected: the corpus is too varied, and a tolerant parse hides an invalid
  answer instead of rejecting it.
- **Live calls everywhere.** Rejected: the 3-hourly new-job scoring is exactly the volume that Batch halves, and nobody
  is waiting on it.
- **A per-user AI key.** Rejected: it would put a vendor secret and its bill in the user's hands for no product gain
  (§1 non-goals).
