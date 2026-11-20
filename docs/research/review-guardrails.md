# Review guardrails: when Overture stops and asks

Research note for the owner's ask, 2026-11-20. Scope: where the pipeline can be wrong, which "not confident" signals
are trustworthy, how to keep Reviews rare, and what the Review flow should be. This is research and a recommendation;
no product code. Sources are linked and dated at the end; every quoted claim was read on 2026-11-20.

## Recommendation

**Keep the name Review.** Nothing found here justifies "Hold" or a second destination. A Review is still "a factual
question Overture will not guess at", and the existing `needs_review` status, one-open-Review-per-question rule and
"unlocks N jobs" card are the right shape.

**Never submit on an unvalidated guess.** Every factual answer must come from a saved Fact (or a Target the user set)
and pass deterministic validation against both the prepared plan and the live form. The model's structured `unknown`
is the trigger for a Review; rules-plus-model agreement is the cheap check that catches a model which maps a question
to the wrong Fact with full confidence; a numeric confidence score is telemetry, never a gate.

**A Review asks for a durable fact, once. It must not ask the user to approve a model-invented answer.** If a
proposed answer is shown, it must be a saved Fact value with its source and revision, not a model guess; otherwise the
card should show only the question and the closest Fact. This avoids anchoring the user into confirming a plausible
wrong value, which is the failure mode the owner is worried about.

**Everything that cannot become a durable Fact is a hard stop or a skip, not a Review.** Identity mismatch,
non-standard consent, required EEO disclosure, a one-off essay that the resume cannot ground, a file field that is not
the resume, a failed upload or a challenge must never submit. The rule is the owner's: when in doubt, do not submit.

**The biggest measured gap is not model confidence; it is answer completeness.** On the recorded Greenhouse forms the
current M1-17 branch marks a required consent, a required "skip" opt-in and any required file field as resolved
without building a value, and a rich work-authorisation select fails option matching. A simulation with the branch's
own rule and option matchers, a filled Canadian Tier-1 profile and one representative value per Fact produced **13
distinct Reviews covering 12 of 12 recorded postings** (35 blocked question instances). That is a simulation of the
current code path, not a production rate: it excludes open-text generation, which M1-18 will add, and it inherits the
branch's "resolved without a value" behaviour for consent, skip and file fields.

**Fix the common cases before tuning confidence.** Country-scope work authorisation and sponsorship, derive
location/workplace answers from Targets, add current job title, work-authorisation type and "how did you hear" in
onboarding, and fix the deterministic cases (legal name, employed-by-this-company, US state list). On the recorded
set those changes remove all 13 in the same simulation. Expect roughly **3–8 Reviews in week 1** for a user sending
about 70 applications across ~20 companies, then **0–2 a week**, with a target below **1 per 10 sent applications**
after week 2. These are estimates, not measurements; only Greenhouse fixtures exist in the repo.

**The Review card already shows the question, the jobs it unlocks and the closest Fact.** Adding a "proposed answer
and why" row is a new visual element: the owner must redraw the Review board first (ADR 0021). Do not build it before
that. Attempt-time Reviews can use the same screen and need no new board.

**Keep the system honest with two numbers, not one.** Track Review rate (per 100 prepared Applications, per ATS, and
per question family) together with a sampled false-answer audit of sent Snapshots. A low Review rate without the
audit is not evidence of correctness; it can be bought by guessing. Target zero false factual answers, zero
wrong-company sends and zero repeat Reviews for the same question.

---

## 1. Where it can go wrong

Severity is about a false or embarrassing submission, not about whether the user gets the job. "Today" means the
M1-17 branch `a-hagi613/m1-24-questions` at commit `1566257` (not yet on `main`); the dispatch and open-text code does
not exist yet, so those rows describe the SPEC contract and the ported v1 behaviour, not shipped v2 code.

| # | Point | What can go wrong | Likelihood | Severity | What exists today / gap |
|---|---|---|---|---|---|
| 1 | Question → Fact mapping | A question is mapped to the wrong Fact, or to `open_text` when it is factual, or to `skip` when it matters. The catalog mapping is global, so one bad LLM call can affect every user asking that wording. | Medium | **High** — a false statement on a form | Rules then one Haiku call with a constrained `{answer_kind, fact_key}`; result cached by normalised question hash; `mapped_by` records rules/llm/owner. The options hash is stored but is not part of identity, so the same wording with different options shares one mapping (per-posting options still validate). Gap: no second opinion, no high-risk gating, no owner review of new global mappings. |
| 2 | Per-country Facts | `work_auth` and `sponsorship_required` are single `facts` rows, while SPEC §7.1 says "per target country". Answering "authorised to work in Canada = yes" can answer "authorised to work in the UK?" with yes. | Medium | **Critical** — visa/authorisation misstatement | `src/shared/facts.ts` has one key; `facts` has a unique `(user_id, key)` index. No scope column. |
| 3 | Option matching | A Fact is correct but no option matches. `matchOption` handles exact normalised text and yes/no families; it returns `null` for Vercel's five work-authorisation options and Cloudflare's hub question. The safe path is a Review, but the Review is caused by the matcher, not by missing user knowledge. | **High** for rich selects | Medium — a Review, or a blank if the caller ignores `null` | `formatSelectValue` → `matchOption`; `null` makes `isResolved` false, so a required field blocks. Gap: no synonyms table for work-authorisation types, countries, degrees, notice periods. |
| 4 | Answer completeness | `isResolved` returns true for `consent` and `skip` unconditionally, and for any `file` field if a resume exists. `answersFor` then returns `answer: null` for all of them. A required privacy consent, a required WhatsApp opt-in and a required "portfolio PDF" are all marked `ready` with no value. | **High** | **High** — a blank required field, or the resume uploaded into the wrong file slot | `prepare.ts` `isResolved` short-circuits before building a value; `answersFor` only formats `fact`. Gap: no complete AnswerPlan, no per-field file Fact, no consent template. |
| 5 | Open text and cover letters | The model writes a fluent claim the resume does not support; a sentence cites a resume line that does not entail it; the grounding check catches numbers, dates, employers and technologies but not "expert", "led", "owned" or a title inflation. | Medium | Medium–High — embarrassing and potentially false | M1-18 is not built. SPEC §8.3 step 4 and issue #25 define sentence-level resume-line ids plus a code grounding check. Gap: claim types beyond the four, and "a cited line" is not proof of entailment (the m1 review said this). |
| 6 | Grounding check itself | False negative (misses an unsupported claim) or false positive (drops a true sentence, leaving a letter with holes). | Medium | Low–Medium | Deterministic code, so it is auditable. Gap: no recorded adversarial corpus yet. |
| 7 | Live form reading | The live form has a field the plan does not cover, a changed label, an option that disappeared, a different required set, a multi-step page or a hidden conditional field. | **High** across ATSes | **High** — a wrong or missing answer | SPEC §10.3 step 5 maps an unexpected required field and stops as `needs_review` if factual and unknown. Not built. Gap: no preflight that re-validates *every* prepared answer against the live DOM. |
| 8 | Upload | The wrong file (old resume, cover letter, portfolio) is uploaded; the upload silently fails; the file is truncated. | Low–Medium | **High** — the central promise is the byte-for-byte resume | SPEC §10.3 uploads the current decrypted resume; Snapshot records the hash. Gap: verify the uploaded filename/hash after `setInputFiles`; map file fields to file Facts, not "any file". |
| 9 | Challenge / bot check | A visible challenge appears; the vendor solver fails; a code prompt never arrives. | Medium | Medium — a failed send, not a false one | SPEC §10.3 steps 6–7; `captcha_blocked`/`code_timeout` retry once then failed. Good. |
| 10 | Submit reading | A confirmation page is mistaken for success when the server rejected the application; or a rejection is mistaken for success. | Low–Medium | **High** — a false `sent`, possibly a duplicate later | ADR 0025 watches the application request; a 2xx/5xx/timeout sets `submit_clicked_at`; a 4xx does not; confirmation signal per ATS; email confirmation within 24 h. Gap: a generic "thank you" page can be ambiguous; add ATS-specific tokens and, where available, the response body/application id. |
| 11 | Company / posting identity | The board token points to the wrong company, a redirect lands on another employer, the posting is reposted under a new id, or the same title/city collides in `dedupe_key`. | Low | **Critical** — applying to the wrong company is the one unrecoverable embarrassment | Candidate filters use `company_id`, domain, normalised name and near-match; `dedupe_key` is company + title + country + city; skip list and current employer. Gap: no check at attempt that the live page's host/board/job id/company match the Posting. |
| 12 | Matching | A low-fit or wrong-location job is auto-submitted; a good job is skipped; salary currency/period is compared wrongly. | Medium | Low–Medium — not a lie, but embarrassing and wastes Applications | SPEC §8.1–8.2 candidate filters, code rank, lazy Haiku score, 80 threshold, skip list, 60-day dedupe. Gap: FX conversion is M1-16 follow-up; "remote" region rules are subtle. |
| 13 | Consent | A marketing opt-in, arbitration clause, background-check consent or "all information is accurate" attestation is treated as a standard privacy acknowledgement. | Medium | **High** — a legal statement the user did not make | Mapping has `consent`; SPEC says only Overture-standard consents the user accepted. Gap: `isResolved` accepts any `consent` and does not build a value; no allowlist of consent texts; no "uncheck the marketing box" action. |
| 14 | EEO | The model infers gender/race/veteran/disability, or a required EEO select is answered from an unset Fact. | Low–Medium | **High** — protected-class misstatement | EEO Facts are Tier 2, opt-in only; rules map gender/race/veteran/disability to those keys. Gap: if required and unset, the current path opens a Review, which pressures disclosure; better is a "prefer not to say" option or skip. |
| 15 | Salary / notice / dates | A number is extracted from the wrong part of a Fact; currency or period is dropped; a date is reformatted to the wrong day. | Medium | Medium | `formatFactValue` extracts the first number, parses dates with `Date`, and returns text otherwise. Gap: currency/period are not modelled; "4 weeks" in a number field becomes 4. |
| 16 | Prompt injection in the Posting | Posting text tells the model to answer "yes" or to ignore the Fact list. | Low | **High** if it reaches a factual answer | Posting guard is ported; question mapping sees only the question and options; open text sees the posting only after the guard. Gap: the guard's coverage is v1 code, not yet tested in v2. |
| 17 | Confirmation email linking | One employer acknowledgement confirms two Applications, or confirms the wrong one when a company has two similar roles. | Low | **High** — false `sent`, duplicate risk | ADR 0025/SPEC §9.4: authenticated mail, sender domain, company/title, after `submit_clicked_at`, 24 h wait. Gap: no ATS application id/thread matching. |
| 18 | LLM outage / cap | A capped or failed mapping call silently leaves a question unmapped; if the caller treats "no mapping" as "safe to skip", a required field is submitted blank. | Medium | Medium | Mapping fails closed (no mapping → `unknown`), caps alert the owner, preparation waits. Gap: a failed batch must not be cached as `unknown` permanently; retry later. |

The pattern: **the model is not the main source of false submissions; incomplete answers and unvalidated assumptions
are.** A confidence score would not have caught rows 2, 3, 4, 8 or 13; deterministic checks and a complete plan will.

---

## 2. Which "not confident" signals are reliable

### 2.1 What the vendors say

Anthropic's hallucination guide is explicit that abstention must be allowed and that citations must be verifiable:

> **Allow Claude to say "I don't know":** Explicitly give Claude permission to admit uncertainty. This technique can
> drastically reduce false information.

> **Verify with citations:** Make Claude's response auditable by having it cite quotes and sources for each of its
> claims. You can also have Claude verify each claim by finding a supporting quote after it generates a response. If it
> can't find a quote, it must retract the claim.

> Remember, although these techniques significantly reduce hallucinations, they don't eliminate them entirely. Always
> validate critical information, especially for high-stakes decisions.

Source: Anthropic, *Reduce hallucinations*,
<https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations> (read 2026-11-20;
`docs.claude.com` redirects here).

Structured outputs buy schema compliance, not truth:

> Structured outputs constrain Claude's responses to follow a specific schema, ensuring valid, parseable output for
> downstream processing.

> Although structured outputs guarantee schema compliance in most cases, there are scenarios where the output might
> not match your schema.

The documented cases are refusals, `max_tokens` truncation and enum-value casing.

Source: Anthropic, *Structured outputs*,
<https://platform.claude.com/docs/en/build-with-claude/structured-outputs> (read 2026-11-20).

Citations are guaranteed to point at the supplied document, but cannot be combined with structured outputs:

> Because the API parses citations into the response formats described in the following sections and extracts
> `cited_text` directly, citations are guaranteed to contain valid pointers to the provided documents.

> **Citations and structured outputs are incompatible.** Citations cannot be used together with structured outputs.
> … the API returns a 400 error.

Source: Anthropic, *Citations*, <https://platform.claude.com/docs/en/build-with-claude/citations> (read 2026-11-20).

OpenAI's documentation states the same boundary from the other side:

> Structured Outputs constrains completed, non-refusal model output to your supplied JSON Schema. Your application
> still needs to handle refusals, incomplete responses, and API errors, and validate any business rules that the schema
> does not express.

Source: OpenAI, *Structured model outputs*, <https://platform.openai.com/docs/guides/structured-outputs> (read
2026-11-20).

The practical reading for Overture: a valid `{answer_kind: "fact", fact_key: "work_auth"}` proves the JSON was
well-formed. It does not prove the question was mapped correctly, the Fact is in scope, or the option exists.

### 2.2 Calibration research

| Signal | Evidence | What it means for Overture |
|---|---|---|
| **Verbalised confidence** ("90% sure") | Xiong et al. benchmark five LLMs and find "LLMs, when verbalizing their confidence, tend to be overconfident, potentially imitating human patterns of expressing confidence", and "all investigated methods struggle in challenging tasks, such as those requiring professional knowledge" (ICLR 2024, <https://arxiv.org/abs/2306.13063>). Tian et al. find verbalised confidence from RLHF models is often *better* calibrated than conditional token probabilities, "often reducing the expected calibration error by a relative 50%" on TriviaQA, SciQ and TruthfulQA (EMNLP 2023, <https://arxiv.org/abs/2305.14975>). Lin et al. show a fine-tuned GPT-3 can express calibrated uncertainty in words and remains "moderately calibrated under distribution shift" (<https://arxiv.org/abs/2205.14334>). Kadavath et al. find larger models are well calibrated on multiple-choice/true-false "when they are provided in the right format", but "struggle with calibration of P(IK) on new tasks" (<https://arxiv.org/abs/2207.05221>). | A confidence number can be useful, but its calibration is model-, task- and prompt-specific. We have no calibration set for Haiku mapping application questions, and a single global threshold would be arbitrary. Do not gate submission on it. If we ever show it, calibrate per field family against audited outcomes. |
| **Structured "unknown"** | Anthropic's first recommendation is to allow "I don't know"; OpenAI's 2025 analysis argues models hallucinate because "the training and evaluation procedures reward guessing over acknowledging uncertainty" (<https://arxiv.org/abs/2509.04664>). A constrained enum with `unknown` makes abstention a first-class, auditable output. | This is the right **trigger** for a Review: cheap, deterministic downstream, and it forces the model to make a decision rather than emit prose. Its weakness is that a model biased to answer will under-use it, so it must be paired with rules and validation. |
| **Agreement of two independent methods** | Rules + model is two different mechanisms; disagreement is a strong signal without another model call. Self-consistency (sample several reasoning paths, take the majority) improves reasoning accuracy (Wang et al., ICLR 2023, <https://arxiv.org/abs/2203.11171>). Semantic entropy clusters sampled answers by meaning and reaches AUROC **0.790** for detecting incorrect answers, versus **0.698** for P(True) and **0.691** for naive entropy, but costs 5–10× more generations (Farquhar et al., *Nature* 630, 625–630, 2024, <https://www.nature.com/articles/s41586-024-07421-0>; Kossen et al., <https://arxiv.org/abs/2406.15927>). | Use rules+model agreement on every mapping (nearly free). Use two prompts or sampling only for the small high-risk set (work authorisation, sponsorship, salary, EEO, legal name, consent), and only when the extra cost is justified. Do not sample ten answers for every field. |
| **Deterministic validation** | The answer must be a known Fact key, the Fact must exist and be in scope, the formatted value must be a valid option/type, the grounding check must pass, and the live form must contain that option. These are code checks with no calibration problem. Selective classification frames the trade-off correctly: a system can guarantee a risk level by rejecting cases and trading away coverage (Geifman & El-Yaniv, <https://arxiv.org/abs/1705.08500>). | This is the **primary gate**. It cannot tell whether the user's Fact is true, but it can stop the system from inventing, mis-scoping or mis-formatting a value. Combine with the Fact source and revision in the Snapshot so the answer is auditable. |
| **Self-review / "are you sure?"** | Huang et al. find LLMs "struggle to self-correct their responses without external feedback, and at times, their performance even degrades after self-correction" (ICLR 2024, <https://arxiv.org/abs/2310.01798>). | Do not add a second "check your answer" prompt and call it a guardrail. Verification needs an external signal: the Fact store, the option list, the resume lines or the live form. |

### 2.3 Verdict

1. **Deterministic validation is the gate.** No answer leaves preparation without a source Fact/Target, a formatted
   value, an option/type check, and (for generated text) a grounding result.
2. **Structured `unknown` is the Review trigger.** It is the model's only permitted way to say "a human must answer
   this"; free-text "I'm not sure" is not parsed.
3. **Rules+model agreement is the cheap safety net.** If rules and model disagree, do not auto-answer; if the question
   is required and durable, open a Review; if it is one-off, skip.
4. **Confidence scores are telemetry.** Log them if the API returns them, use them to prioritise audits, never as the
   only reason to submit or stop.
5. **Do not ask the user to approve a model guess.** Ask for the Fact. A "looks right?" tap on a hallucinated value is
   worse than a blank, because it converts a model error into the user's own statement.

---

## 3. Keeping Reviews rare

### 3.1 What already works

- **One Review per (user, question)**, enforced by `reviews_user_question_open_unique` (partial unique index on
  `status = 'open'`). Answering closes it and re-prepares every attached Application; dismissing skips them.
- **Batching**: the card and list show `unlocked` Applications and distinct companies, so one answer can unlock
  several jobs.
- **Reuse**: answering an unknown question saves `q:<question_id>` as a Tier-3 Fact; every later Application asking
  the same question gets the Fact without a new Review.
- **Mapping cache**: questions are normalised (`lowercase`, company names stripped, numbers stripped, punctuation
  collapsed) and stored once in the shared catalog with a variant hash; the mapping (`answer_kind`, `fact_key`) is
  reused across postings.
- **Unlock counts**: a posting closing detaches it; an empty Review auto-dismisses.

Two caveats:

- **Reuse is per user, not global.** The catalog is shared, but the Fact is per user. A new user answering the same
  question still sees the Review unless onboarding already has the Fact. Onboarding is the only way to make the first
  week quiet for everyone.
- **The mapping is global.** `setMapping` on one user's answer, or one LLM call, changes the mapping for every user.
  That is efficient and risky. High-risk keys need a validation gate before the global mapping is trusted, or an
  owner-only approval path once the admin exists.

### 3.2 Measured baseline from the recorded Greenhouse forms

Inputs: 12 recorded postings from 3 companies (Cloudflare 4, Stripe 4, Vercel 4), 37 distinct normalised questions,
in `test/e2e/fixtures/greenhouse/*/*.questions.json` (branch `a-hagi613/m1-24-questions`). Method: run the branch's
`mapQuestionByRules`, `normalizeFieldType` and `matchOption` against each required question, with a filled Canadian
Tier-1 profile and one representative value per Fact. No network, no synthetic data.

| Measure | Result |
|---|---|
| Recorded postings | 12 |
| Distinct normalised questions | 37 |
| Postings with at least one required question that blocks | **12 of 12 (100 %)** |
| Blocked question instances | **35** |
| Distinct Reviews if every block were a question (one Review per distinct question) | **13** |

The 13 families are:

- work authorisation with a five-option list (3 postings) and "authorised to work in the UK?" (1) — option mismatch,
  not a missing Fact;
- "Do you live in one of the following states?" (3) — no state Fact and no geo derivation;
- "Where did you first hear about this role?" (4) and "How did you hear about this job?" (4) — two normalised
  variants, no Fact;
- "What is your current or previous job title?" (4) — no current-title Fact;
- "Please select the country or countries you anticipate working in…" (4) — should come from Targets, not a Fact;
- "If this role offers the option to work from a remote location…" (2), "Are you open to working from the South San
  Francisco office…" (1) and "This role is Sydney based…" (2) — workplace preference, should come from Targets or a
  skip;
- "Have you ever been employed by Stripe or a Stripe affiliate?" (4) — derivable from employment history;
- "Legal Name (if different than above)" (2) — a rule gap, not a missing Fact;
- "This role requires that you live in one of the following hubs…" (1) — mapped to `current_city` but the options are
  relocation choices, so it is an option/mapping mismatch.

This is the current code path, not a production sample. It already treats `consent`, `skip` and `file` as resolved
(see §1 row 4), so the real number could be worse once the executor fills the blanks.

### 3.3 What removes the Reviews (and what only hides them)

**Onboarding (ask once, before the first send):**

- current job title (also prefill from the latest employment-history role);
- work-authorisation type per target country: citizen / permanent resident / work permit without sponsorship / needs
  sponsorship / other — this is what maps to the five-option forms; a boolean `yes` cannot;
- "how did you hear about this job" preference, with an explicit "Other" only when the form has it; do not default to
  "LinkedIn" without the user's word;
- EEO opt-in, with "prefer not to say" as a first-class answer;
- salary by currency/period and notice period in the unit the forms use.

**Targets (already user-set; use them, do not ask):**

- countries the user anticipates working in = target locations;
- remote/hybrid/onsite willingness = target workplaces;
- willing to relocate = target locations + `willing_relocate`;
- if the Posting's location/workplace conflicts with Targets, **skip at the candidate stage**; do not ask a question
  whose honest answer is "no" for a job the user would not take.

**Deterministic derivations (no model, no Review):**

- "Legal Name (if different than above)" → the same `legal_name` when the answer is no different; fix the rule's
  anchored `^(full |legal )?name$` pattern.
- "Have you ever been employed by X?" → compare X with `employment_history` and `skip_companies`; a match means yes
  (and likely a skip), no match means no only if the history is complete and confirmed.
- "Do you live in one of these US states?" → derive from `current_city`/region with the geo data; if the country is
  not the US, the question is not applicable.
- "Please indicate your current city, state, and country" → format a composite answer from city + region + country,
  not just the city.

**Do not hide Reviews by guessing.** A default value for "how did you hear" or EEO is a false statement if the user
never said it. A default "No" for marketing opt-in is a preference the user can set once; a default "No" for
"authorised to work" is a lie. The distinction is whether the Fact is a user preference (safe to default, user can
change) or a fact about the user's life (never default).

### 3.4 Estimate for a typical user

Assumptions, stated so they can be checked: a senior backend engineer in Canada, 10 Applications a day, 70 in week
1, ~20 companies across 3 ATSes, a question mix similar to the recorded set, and the onboarding/derivation work above
shipped. Reviews are counted as distinct questions, not per Application.

| Period | Estimate | Why |
|---|---|---|
| Today, rules only, recorded set | 13 Reviews to cover 12 postings | §3.2 |
| After the fixes, recorded set | 0 Reviews | every family is answered by a Fact, a Target or a derivation |
| Week 1, live | 3–8 Reviews | new companies ask new variants; one Review per new durable family; duplicates collapse |
| Week 2–4 | 0–2 a week | Tier-3 Facts and the shared catalog absorb repeats; new ATS/company forms still introduce families |
| Steady state | < 1 per 10 sent Applications | target, not a measurement; monitor per ATS |

The honest conclusion: **the recorded Greenhouse set can be made Review-free, but a live job search will never be
zero.** New companies, new ATSes and new question wordings are the long tail. The goal is not "no Reviews"; it is
"no false submissions, and Reviews only for facts we genuinely do not have."

### 3.5 Measure per ATS

There are no recorded Lever or Ashby question fixtures in the repo, so the 13/12 number is Greenhouse-only. Add a
per-ATS review-rate query and capture Lever/Ashby forms with the existing fixture job before quoting a cross-ATS
number. Do not generalise the Greenhouse result to Lever or Ashby.

---

## 4. Hard stops vs Reviews vs safe automation

The owner's rule is the tie-breaker: **when in doubt, do not submit.** A skipped Application costs an opportunity; a
false statement or a wrong-company send costs trust and cannot be undone.

### Hard stop / skip (never submit; a reason on Home)

- **Identity mismatch**: the live page's host, board token, job id or company does not match the Posting; the Posting
  redirected to a different employer; the company is on the skip list or is the current employer (including a near
  name match). Reason: "This didn't look like the job Overture prepared for, so it didn't send."
- **Posting closed, duplicate, already sent** (existing `posting_closed`, `duplicate`, 60-day guard).
- **Location/workplace conflict with Targets**: the job is onsite in a city the user will not work in, or the
  workplace is excluded. Skip before preparation; do not ask "are you willing?" for a job the user filtered out.
- **A required file that is not the resume/letter** (portfolio, writing sample, transcript). There is no Fact for it;
  uploading the resume is worse than skipping.
- **Non-standard consent**: marketing opt-in, arbitration, background check, immigration sponsorship declaration,
  "all information is accurate" when the plan is not fully validated. Never auto-consent to something the user did
  not accept.
- **Required EEO disclosure with no "prefer not to say"** and no opt-in Fact. Do not pressure disclosure with a
  Review.
- **A one-off required essay** ("describe a project", "why this company") that the resume cannot ground and that is
  not reusable across jobs. Skipping is honest; a Review would be a per-job writing task, not automation.
- **File upload failure, challenge after retries, code timeout, form structure changed beyond the plan, unsupported
  ATS step.** Existing outcome table already treats these as retry-once-then-failed; none should become a Review.
- **Too many unexpected required fields** (say, more than two new required questions on a form whose signature was
  known). This is a signal that the ATS changed; stop and alert, do not improvise.

### Review (one durable Fact, asked once, reused)

- A **required factual question** whose answer is stable across Applications: work authorisation for a country,
  sponsorship, notice period, earliest start, salary expectation in a currency, current job title, "how did you hear"
  (if the user wants to set it), EEO only if the user opted in.
- A question that **blocks at least one Application** and is not answerable from an existing Fact or Target.
- An **attempt-time unexpected required field** that is factual and durable. The attempt stops before Submit, the
  Application goes to `needs_review`, the Review attaches it, and answering re-prepares and allows a new attempt.
- **Never** a Review for "please confirm this model answer". If a proposed answer exists, it comes from a Fact; the
  card shows the Fact and its source, and the user can change it.

### Safe to automate

- Any Fact/Target answer that passes: known key, in-scope, formatted value, option exists in the live form, type
  matches, and (for text) the grounding check passes.
- Standard consents the user accepted in onboarding, matched by a stable text hash, not by the word "privacy".
- Optional marketing/opt-in questions: leave blank or select "No" **only** when the user set that preference; never
  select "Yes".
- The resume file, byte-for-byte, when the field is the resume field and the hash matches the current resume.
- Derived answers listed in §3.3, with the derivation recorded in the Snapshot so the user can see why.

### The decision rule in one line

> If the answer can be traced to a Fact or Target the user set and passes deterministic validation on the live form,
> automate it. If a durable Fact is missing, ask once. If neither is true, do not submit.

---

## 5. Recommendation against the architecture

### 5.1 Vocabulary and Review kinds

- **Keep "Review".** No strong reason to rename; "Hold" remains banned (ADR 0020 / `GLOSSARY.md`).
- **No new Review kind now.** The existing question Review covers preparation and attempt-time missing facts. A
  "confirm the AI" kind would be a new interaction with anchoring risk and no board; do not add it.
- If provenance is needed, add fields, not a new destination: `review.kind = 'question'`, `source =
  'preparation' | 'attempt'`, `reason = 'unknown_required' | 'option_mismatch' | 'mapping_disagreement' |
  'scope_missing'`. A future `kind = 'form_check'` can be added when the owner has drawn it; it is not needed for M1.
- **Consent is not a Review.** If the consent is non-standard, the Application is skipped. Asking the user to consent
  mid-pipeline would make Overture a party to a legal statement it cannot verify.

### 5.2 Status flow

`preparing` → `needs_review` (one or more open Reviews, each attached to this Application) → `ready` only when every
attached Review is answered and `application.prepare` succeeds again. Dismissing a Review skips its attached
Applications (`review_dismissed`). A posting that closes detaches; an empty Review auto-dismisses.

Attempt-time path: `sending` → outcome `needs_review` (before `submit_clicked_at`, nothing sent, ledger released) →
status `needs_review`, Review attached, `attempts` does **not** consume one of the two tries (it is not a failure of
the form, it is an unanswered fact) → after the answer, `prepare` → `ready` → planner schedules. If the live form
changed structurally or identity fails, do not use `needs_review`: use `skipped`/`form_changed` and never retry.

`needs_review` stays in the `Queued` Stage (SPEC §8.5); no new stage. The "Needs you" pill is the existing label.

### 5.3 Data model changes

Minimum to make the above real:

1. **Fact scope.** `facts` gets `scope text not null default ''` and the unique index becomes `(user_id, key, scope)`.
   `work_auth` and `sponsorship_required` use `scope = <ISO country>`; a question mapped to either must carry the
   country it asks about, or it opens a Review. This is the fix for §1 row 2 and cannot wait: a single row is a
   misstatement risk. Existing rows migrate to `scope = ''` and are treated as "unscoped, only for questions that do
   not name a country".
2. **Review provenance.** `reviews` gets `kind` (`question` default), `source` (`preparation` | `attempt`),
   `reason`, `proposed_fact_key`, `proposed_value`, `proposed_revision`, `form_signature`, `attempt_id`. The proposed
   value is optional and must be a Fact value; it is not a model guess.
3. **Question risk and validation.** `questions` gets `risk` (`low` | `high`) and `validated_options_hash`; high-risk
   keys (work authorisation, sponsorship, salary, EEO, legal name, consent) require an exact option match or a
   Review. `mapping_agreement` (`rules_llm`, `llm_only`, ...) can be derived from existing `mapped_by` plus a rules
   check; no need to store a raw confidence.
4. **Attempt preflight.** `attempts` gets `form_signature`, `preflight_result` (`ok` | `answer_missing` |
   `option_missing` | `identity_mismatch` | `form_changed`) and `preflight_detail`. This is evidence for the audit.
5. **Events.** `review.created`, `review.answered`, `review.dismissed`, `answer.auto`, `answer.blocked`,
   `preflight.failed` in the existing `events` table; metrics read from these plus `applications`.
6. **No `confidence` column.** Store the deterministic reason, not a score. If the LLM returns a score, log it in
   telemetry only.

### 5.4 Where the checks run

**Preparation (`application.prepare`) — plan:**

1. Load the question list (Greenhouse pre-flight; Lever/Ashby from `plan_cache` or first attempt).
2. Map each question: rules first, then one Haiku call; if rules and model disagree, do not auto-answer. Record
   `mapped_by` and the reason. Retry still-unmapped questions on later preparations; `questionsFetchedAt` must not
   freeze a failed or capped batch as permanently `unknown`.
3. Build a **complete AnswerPlan**: every field gets `{value, source: fact|target|consent|skip|file, fact_key,
   revision, evidence}` or a typed block (`missing_fact`, `unsupported`, `non_standard_consent`, `file_unavailable`).
   "Resolved" is not enough; the plan must contain the value the executor will type.
4. Validate each value against the question's field type/options; if an option is missing, try the synonyms table,
   then open a Review with `reason = 'option_mismatch'` (not `unknown_required`).
5. Enforce consent policy (hash allowlist), EEO policy (opt-in or "prefer not to say"), file policy (resume only in
   the resume field), and scope policy (country-scoped Facts).
6. Only an empty block list sets `ready`.

**Attempt (`submit.run`) — truth:**

1. Read the live form (ARIA/DOM), compute its signature, and compare with the plan. If the signature changed, rebuild
   or stop; do not submit a stale plan.
2. For **every** prepared answer, confirm the field exists, the type matches and the option is present in the live
   form. For text, confirm the field is visible and enabled. For file, confirm the file input is the resume/letter
   field and the upload hash matches.
3. If a required field is not covered: map it; if factual and durable → stop as `needs_review`; if one-off,
   unsupported or non-standard → `form_changed`/`skipped`.
4. Verify identity: host, board token, job id, company name. Mismatch → skip, never submit.
5. Final preflight immediately before Submit: every answer present, every required field filled, every consent
   checked/unchecked as planned, no unexpected new required field. Any failure → do not click.
6. Submit per ADR 0025; confirm per ATS signal + email. A missing confirmation is `unconfirmed`, never a retry.

The ordering matters: **preparation decides what to say; the attempt decides whether it is still true.** The live
form is the source of truth for options, requiredness and identity. A plan that was valid at preparation can be
invalid five minutes later.

### 5.5 What the Review card must show

Within the existing Review board:

- **The question**, exactly as the form asks it (already).
- **The jobs it unlocks**, by company and title, and the count (already).
- **Why Overture stopped**: missing Fact, option mismatch, scope missing, or a mapping disagreement. This is a short
  reason line, not a model narrative.
- **The closest Fact and its source** (already, as "Closest fact"): label, value, "from your resume" / "you entered" /
  "imported", and revision. If a proposed value is shown, it is this Fact value; never a model-composed answer.
- **The answer input**, matching the field type/options (already).
- **Dismiss**: "Skip these N jobs" (already). It must be clear that dismissing does not guess.

New visual element warning: the current card has question → unlocks → closest Fact → answer. A "proposed answer and
why" row is not on the existing board. **The owner must redraw w5-holds before it is built (ADR 0021).** Until then,
ship the reason line inside the existing "Closest fact" block only if it fits without a new layout; otherwise leave it
out. Do not invent a second screen, a modal, or a confidence meter.

### 5.6 Metrics that keep it honest

Definitions, so they cannot be redefined later:

- **Review rate** = distinct Reviews opened ÷ 100 Applications that reached `preparing`, overall and per ATS.
- **Blocked-application rate** = Applications that entered `needs_review` ÷ Applications that reached `preparing`.
- **Question-family rate** = Reviews per normalised question hash; the long tail is the interesting part.
- **Repeat rate** = Reviews opened for a question already answered by the same user ÷ all Reviews. Target **0**; a
  repeat means the Fact was not reused, the mapping changed, or preparation failed.
- **Answer rate and time to answer**: how many Reviews are answered vs dismissed, and median time. A Review that is
  never answered is a product bug, not a user failure.
- **Auto-answer audit**: sample 1 in 20 sent Snapshots (owner-only in M1). For every factual answer, check the Fact
  exists at the recorded revision, the value matches, and (for a select) the option existed in the live form. Any
  mismatch is a **false answer**. Target **0**.
- **False-submit audit**: sample sent Snapshots for wrong company, duplicate, and a factual claim the Fact does not
  support. Target **0**; any hit is a P1.
- **Hard-stop rate by reason**: identity, consent, file, form change, closed, duplicate. A rising `form_changed` rate
  is an ATS regression signal.
- **Attempt-time Review rate**: Reviews opened from `attempt` ÷ attempts. This is the metric that catches a
  preparation plan that looked complete but was not.

Pairing is the point: a team can drive Review rate to zero by guessing, and can drive false answers to zero by
reviewing everything. Report both, and report coverage (sent ÷ prepared) alongside them.

### 5.7 Rollout

1. M1, owner only: Review on every unknown required question; no auto-answer of high-risk keys; audit every sent
   Snapshot manually (the volume is small).
2. After 50 sent Applications and zero false answers in the audit: enable auto-answer for low-risk keys with exact
   option matches (name, email, phone, links, city/country, years, degree, languages).
3. High-risk keys (work authorisation, sponsorship, salary, EEO, legal name, consent) stay Review-or-exact-match until
   there is a measured per-family audit. Do not turn on a global confidence threshold.
4. Only then consider an admin allowlist for global question mappings; that needs an admin board, which does not
   exist yet. Do not build it from this note.

---

## Sources

All read 2026-11-20.

- Anthropic, *Reduce hallucinations*:
  <https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations> (the
  `docs.claude.com` URL redirects here).
- Anthropic, *Structured outputs*: <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>.
- Anthropic, *Citations*: <https://platform.claude.com/docs/en/build-with-claude/citations>.
- OpenAI, *Structured model outputs*: <https://platform.openai.com/docs/guides/structured-outputs>.
- Xiong, Hu, Lu, Li, Fu, He, Hooi, *Can LLMs Express Their Uncertainty? An Empirical Evaluation of Confidence
  Elicitation in LLMs*, ICLR 2024: <https://arxiv.org/abs/2306.13063>.
- Kadavath et al., *Language Models (Mostly) Know What They Know*: <https://arxiv.org/abs/2207.05221>.
- Tian et al., *Just Ask for Calibration: Strategies for Eliciting Calibrated Confidence Scores from Language Models
  Fine-Tuned with Human Feedback*, EMNLP 2023: <https://arxiv.org/abs/2305.14975>.
- Lin, Hilton, Evans, *Teaching Models to Express Their Uncertainty in Words*: <https://arxiv.org/abs/2205.14334>.
- Wang et al., *Self-Consistency Improves Chain of Thought Reasoning in Language Models*, ICLR 2023:
  <https://arxiv.org/abs/2203.11171>.
- Farquhar, Kossen, Kuhn, Gal, *Detecting hallucinations in large language models using semantic entropy*, *Nature*
  630, 625–630 (2024): <https://www.nature.com/articles/s41586-024-07421-0>.
- Kossen et al., *Semantic Entropy Probes: Robust and Cheap Hallucination Detection in LLMs*:
  <https://arxiv.org/abs/2406.15927>.
- Huang et al., *Large Language Models Cannot Self-Correct Reasoning Yet*, ICLR 2024: <https://arxiv.org/abs/2310.01798>.
- Kalai, Nachum, Vempala, Zhang, *Why Language Models Hallucinate*: <https://arxiv.org/abs/2509.04664>.
- Geifman & El-Yaniv, *Selective Classification for Deep Neural Networks*: <https://arxiv.org/abs/1705.08500>.

Project sources read: `GLOSSARY.md` ("Review", "Needs you", "Status"); `docs/SPEC.md` §1, §7.1, §8.1–§8.6, §9.3–§9.4,
§10.3; `docs/adr/0007-facts-only-answers.md`, `0009`, `0020`, `0025`; `docs/SALVAGE.md`; `DESIGN.md` §13; branch
`a-hagi613/m1-24-questions` commit `1566257` (`prepare.ts`, `reviews.ts`, `review-store.ts`, `questions.ts`,
`question-rules.ts`, `question-normalize.ts`, `question-mapping.ts`, `schema.ts`, `drizzle/0016_question_catalog_reviews.sql`,
`review-detail.tsx`); `test/e2e/fixtures/greenhouse/*/*.questions.json` on that branch.

---

## Proposed tickets

These are proposals for the owner to file or reject; they are not implemented here.

1. **M1-17a — Country-scoped work-authorisation and sponsorship Facts.**
   Add `facts.scope`, migrate the unique index to `(user_id, key, scope)`, map `work_auth` and
   `sponsorship_required` to the country a question names, and make a country-less question with a scoped Fact open a
   Review. Delivers the fix for the only Critical false-statement risk. Blocked by #24.

2. **M1-17b — A complete AnswerPlan and a real preflight.**
   `prepare` builds a value or a typed block for every field (fact, target, consent, skip, file); a required consent,
   skip or file field is no longer "resolved" with no value; file fields map to a file Fact (resume, letter) and never
   to "any file". Delivers `ready` meaning "every answer exists and passed type/option validation". Blocked by #24
   and #25.

3. **M1-17c — Live-form preflight and attempt-time Reviews.**
   On the attempt, compare the live signature with the plan, validate every answer/option/file/consent against the
   DOM, verify identity, and stop before Submit on any mismatch. A durable missing Fact opens a Review and stores the
   attempt provenance; a one-off/unsupported field is `form_changed`/skipped. Blocked by #28 and #30.

4. **M1-17d — Deterministic answers from Targets and simple derivations.**
   Use Targets for anticipated countries, remote/hybrid/onsite and relocation; derive "legal name if different",
   "employed by X", US state list and a composite city/state/country answer. Removes five of the 13 fixture Review
   families without asking the user anything new. Blocked by #24.

5. **M1-17e — Onboarding questions that remove the common Reviews.**
   Add current job title, work-authorisation type per target country, "how did you hear" (optional), salary by
   currency/period, and EEO opt-in with "prefer not to say", each with "unlocks N queued jobs". This is the only way
   to make a new user's first week quiet. Blocked by #24 and the M2 onboarding ticket (not yet open).

6. **M1-17f — Review and false-submit metrics.**
   Emit the events in §5.6, add owner-only queries/reports for Review rate per ATS and question family, repeat rate,
   auto-answer audit and false-submit audit. No admin screen until the owner draws one. Blocked by #24 and #30.

7. **M1-17g — Company and posting identity check at attempt.**
   Before Submit, verify the live host, board token, job id and company against the Posting; mismatch skips with a
   reason and never submits. Delivers the zero-wrong-company gate for M1. Blocked by #28.

8. **M1-17h — Lever and Ashby question capture and a per-ATS Review baseline.**
   Record Lever/Ashby question fixtures with the existing capture job, then repeat the §3.2 measurement per ATS.
   Without this, the Greenhouse number must not be generalised. Blocked by #32.

9. **M1-17i — Fix the option matcher for rich selects.**
   Add explicit synonym tables for work-authorisation types, countries, degrees, notice periods and salary periods;
   return a typed `option_missing` review reason instead of a generic unknown. This turns several "we don't know"
   Reviews into exact answers. Blocked by #24.
