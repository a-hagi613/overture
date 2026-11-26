# Runbook: application observability alerts

Every alert below reaches the owner through ntfy and the Admin overview. The
Application lookup page (`/admin/lookup?application=<id>`) shows the same
timeline, queue jobs, attempts, confirmation, ledger and mail that the alert
summarises.

## `application.confirming_stuck`

**Means:** one or more Applications have sat in `confirming` for more than 26
hours, so no page acknowledgement and no matching mail arrived before the
confirm wait elapsed (the wait defaults to 24 hours).

**First check:** open the Application lookup and read its timeline for
`confirming`; check the latest attempt's `submitClickedAt`, the linked mail
threads, and the `dispatch.recover` job. If the employer confirmation is real
but the mail never matched, fix the mail match before releasing the credit.

## `application.cost`

**Means:** the average recorded variable cost per sent Application exceeded the
$0.03 gate over the last hour and there were at least five sends to judge.

**First check:** compare the Application's `browserCostMicros`,
`retryCostMicros` and `llmCostMicros` in the lookup. Retry cost usually means a
form changed or a provider retried; model cost belongs to the matching and
answer steps, not the browser session.

## `match.unscored`

**Means:** more than 2,000 `matches` rows have no score, so the scored queue is
falling behind the code-ranked candidates.

**First check:** the Admin LLM page and `llm.cap` alerts. A cap pause, a batch
that is stuck `in_progress`, or a high schema-rejection rate all leave rows
unscored. The next planner run resumes once the cause clears.

## `mail.forwarding`

**Means:** an outbound message bounced or failed, or an inbound forwarded copy
failed authentication, in the last hour.

**First check:** the linked mail thread in the Application lookup. For inbound
failures, compare the sender domain with the employer or ATS domain and confirm
the forwarding address still exists. For outbound failures, read the transport
error before retrying.

## `llm.schema_rejection`

**Means:** more than 5% of Anthropic calls in the last hour returned an answer
that failed its zod schema (at least five samples). Rejected free text is never
stored.

**First check:** the Admin LLM page by purpose. A single purpose failing points
at a prompt or schema change; every purpose failing points at the model or the
batch plumbing. One retry is allowed, then the answer is rejected.
