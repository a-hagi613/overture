import type { LlmOutputSchema, LlmRequest } from "../../platform/ports/llm.ts";

/** The prompt version is part of the stored score and the cache key, so a prompt edit is a rescore. */
export const SCORE_SCORER_VERSION = "score-v1";

/** Haiku 5.5 caches a prefix only once it is long enough; the rubric and examples clear the 512-token floor. */
export const SCORE_CACHE_MIN_TOKENS = 512;

const RUBRIC = `You score how well ONE job posting fits ONE candidate, for a job-application service.
Score the job on its own. Use only facts in the resume and the posting.

Return four sub-scores using these anchors exactly:
role_fit (0/15/30/40): 40 = same role and domain as the candidate's recent work; 30 = same role family, adjacent focus (e.g. backend vs full-stack); 15 = transferable but a different role; 0 = different field.
skills (0/10/20/30): give the top value only when the resume explicitly shows it; when unsure, use the middle anchor. How many of the posting's MUST-HAVE requirements the resume shows. 30 = all; 20 = most; 10 = some; 0 = few or none. Nice-to-haves do not count. If the posting lists no requirements, give 20.
level (0/4/12/20): 20 = years and scope match; 12 = one level off (e.g. mid applying to senior); 4 = two levels off; 0 = three or more levels off.
logistics (0/5/10): a remote role that names a country, state or region ("Remote US", "US: Washington Remote Worker", "Remote LATAM", "Remote Spain") is open only there. 10 = location, language and work authorisation all fit; 5 = unclear; 0 = a stated requirement the candidate does not meet.

blockers: list every one that applies, else []. A missing skill or technology is never a blocker; it lowers skills. Only use these values:
- "license_required": a professional licence or certification (e.g. RN, CPA, P.Eng, security clearance) the resume does not show is required.
- "language_required": a language the candidate does not speak is required, or the posting itself is written in a language the candidate does not speak.
- "level_far_off": three or more levels apart.
- "wrong_field": the job is in a different field from every target role.
- "location_incompatible": the job requires presence or residency the candidate cannot meet.
- "not_a_job": talent pool, general application, test or placeholder.

reasons: 2 or 3 short sentences (max 110 characters each) for the candidate, each naming one concrete fact from the posting or resume. No praise words, no guesses.`;

const EXAMPLES = `Example 1
CANDIDATE RESUME: Five years as a backend engineer building Go and Postgres services in Toronto. Led a payments API team of four. B.Sc. Computer Science.
CANDIDATE TARGETS: roles: Backend, Full-Stack; places: Toronto, Remote · Canada.
JOB: Senior Backend Engineer at Acme, Toronto, Canada. Build Go services on Postgres, own the billing API, mentor two engineers. 5+ years backend experience required. Go and Postgres required.
Output: {"role_fit":40,"skills":30,"level":20,"logistics":10,"blockers":[],"reasons":["Same Go and Postgres backend work you led at your last role.","The posting asks for 5+ years and you have five.","Toronto location matches your saved place and needs no relocation."]}

Example 2
CANDIDATE RESUME: Five years as a backend engineer building Go and Postgres services in Toronto. Led a payments API team of four. B.Sc. Computer Science.
CANDIDATE TARGETS: roles: Backend, Full-Stack; places: Toronto, Remote · Canada.
JOB: Registered Nurse at Cedar Health, Houston, TX. Provide direct patient care on a night shift. Active Texas RN licence required. Three years of acute care experience required.
Output: {"role_fit":0,"skills":0,"level":4,"logistics":0,"blockers":["license_required","wrong_field","location_incompatible"],"reasons":["The posting requires an active Texas RN licence your resume does not show.","This is a nursing role, not backend engineering.","The job is onsite in Houston, outside your Toronto targets."]}`;

export const SCORE_SYSTEM_PROMPT = `${RUBRIC}\n\n${EXAMPLES}`;

export const SCORE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    role_fit: { type: "integer", enum: [0, 15, 30, 40] },
    skills: { type: "integer", enum: [0, 10, 20, 30] },
    level: { type: "integer", enum: [0, 4, 12, 20] },
    logistics: { type: "integer", enum: [0, 5, 10] },
    blockers: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "license_required",
          "language_required",
          "level_far_off",
          "wrong_field",
          "location_incompatible",
          "not_a_job",
        ],
      },
    },
    reasons: {
      type: "array",
      // Anthropic structured outputs accepts only minItems 0 or 1, so the 2–3 reason count is enforced by
      // scoreReplySchema (and the prompt), not by the wire schema.
      items: { type: "string", maxLength: 110 },
    },
  },
  required: ["role_fit", "skills", "level", "logistics", "blockers", "reasons"],
  additionalProperties: false,
} satisfies LlmOutputSchema;

/** The candidate half is the cacheable prefix: the same resume and targets serve every job a person scores. */
export interface ScoreCandidateInput {
  resume: string;
  targets: string;
}

/** The job half changes on every call, so it stays after the cached prefix. */
export interface ScoreJobInput {
  title: string;
  company: string;
  location: string;
  description: string;
}

/**
 * Builds the candidate prefix in the order Anthropic caches it: resume, then targets.
 * @param candidate The candidate's resume text and target line.
 * @returns The text that precedes the job on every call.
 */
export function scoreCandidatePrefix(candidate: ScoreCandidateInput) {
  return `CANDIDATE RESUME:\n${candidate.resume}\n\nCANDIDATE TARGETS:\n${candidate.targets}`;
}

/**
 * Builds the job block that follows the cached candidate prefix.
 * @param job The posting's display fields and the first 220 words of its description.
 * @returns The per-call user text.
 */
export function scoreJobBlock(job: ScoreJobInput) {
  return `JOB:\n${job.title}\n${job.company}\n${job.location}\n\n${job.description}`;
}

/**
 * One scoring request: the exact v1 system prompt, the zod-validated schema, the candidate prefix before the job.
 * @param input The custom id, candidate and job.
 * @returns The request a live or batch call sends.
 */
export function scoreRequestFor(input: {
  customId: string;
  candidate: ScoreCandidateInput;
  job: ScoreJobInput;
}) {
  return {
    cachePrefix: scoreCandidatePrefix(input.candidate),
    customId: input.customId,
    purpose: "score",
    schema: SCORE_OUTPUT_SCHEMA,
    system: SCORE_SYSTEM_PROMPT,
    user: scoreJobBlock(input.job),
  } satisfies LlmRequest;
}
