import type { AnswerKind } from "../../shared/questions.ts";

export interface RuleMapping {
  answerKind: AnswerKind;
  factKey: string | null;
}

const SKIP_MAPPING: RuleMapping = { answerKind: "skip", factKey: null };

const CONSENT_MAPPING: RuleMapping = { answerKind: "consent", factKey: null };

const OPEN_TEXT_MAPPING: RuleMapping = { answerKind: "open_text", factKey: null };

export const mapQuestionByRules: (text: string) => RuleMapping | null = mapQuestionByRulesValue;

const SKIP_PATTERN =
  /\b(?:whatsapp|sms|text messages|marketing|newsletter|promotion|job alerts|talent pool|future opportunities|opt in|opt-in)\b/u;

const CONSENT_PATTERN =
  /\b(?:privacy|data processing|terms|acknowledge|acknowledgement|consent|double check|double-check|accuracy|accurate)\b/u;

const RULES: readonly { pattern: RegExp; mapping: RuleMapping }[] = [
  {
    pattern:
      /\b(?:will you|do you) (?:now or in the future )?require (?:visa|immigration|work)? ?sponsor/u,
    mapping: { answerKind: "fact", factKey: "sponsorship_required" },
  },
  {
    pattern: /\b(?:require|need) (?:visa|immigration|work)? ?sponsor/u,
    mapping: { answerKind: "fact", factKey: "sponsorship_required" },
  },
  {
    pattern: /\bsponsor(?:ship)?\b/u,
    mapping: { answerKind: "fact", factKey: "sponsorship_required" },
  },
  {
    pattern: /\b(?:authoriz|authoris)(?:ed|ation)? to work\b/u,
    mapping: { answerKind: "fact", factKey: "work_auth" },
  },
  {
    pattern: /\b(?:right|eligible|eligibility|legally) to work\b/u,
    mapping: { answerKind: "fact", factKey: "work_auth" },
  },
  {
    pattern: /\b(?:work authori[sz]ation|work permit|work visa)\b/u,
    mapping: { answerKind: "fact", factKey: "work_auth" },
  },
  {
    pattern: /\bsecurity clearance\b/u,
    mapping: { answerKind: "fact", factKey: "security_clearance" },
  },
  {
    pattern: /\b(?:driver'?s? licen[cs]e|driving licen[cs]e)\b/u,
    mapping: { answerKind: "fact", factKey: "drivers_license" },
  },
  {
    pattern: /\b(?:first name|given name)\b/u,
    mapping: { answerKind: "fact", factKey: "legal_name" },
  },
  {
    pattern: /\b(?:last name|family name|surname)\b/u,
    mapping: { answerKind: "fact", factKey: "legal_name" },
  },
  {
    pattern: /^(?:full |legal )?name$/u,
    mapping: { answerKind: "fact", factKey: "legal_name" },
  },
  {
    pattern: /\b(?:e-?mail|email address)\b/u,
    mapping: { answerKind: "fact", factKey: "email" },
  },
  {
    pattern: /\b(?:phone|mobile|telephone)\b/u,
    mapping: { answerKind: "fact", factKey: "phone" },
  },
  {
    pattern: /\blinkedin\b/u,
    mapping: { answerKind: "fact", factKey: "linkedin_url" },
  },
  {
    pattern: /\bgithub\b/u,
    mapping: { answerKind: "fact", factKey: "github_url" },
  },
  {
    pattern: /\b(?:portfolio|personal website|website|blog|homepage)\b/u,
    mapping: { answerKind: "fact", factKey: "website_url" },
  },
  {
    pattern: /\b(?:city|town|where do you live|current location|currently located)\b/u,
    mapping: { answerKind: "fact", factKey: "current_city" },
  },
  {
    pattern:
      /\b(?:country where you (?:currently )?(?:reside|live)|current country|country of residence)\b/u,
    mapping: { answerKind: "fact", factKey: "current_country" },
  },
  {
    pattern: /\b(?:are you currently based in|based in any of these countries)\b/u,
    mapping: { answerKind: "fact", factKey: "current_country" },
  },
  {
    pattern:
      /\b(?:current or previous employer|current employer|presently employed|who do you work for)\b/u,
    mapping: { answerKind: "fact", factKey: "current_employer" },
  },
  {
    pattern: /\b(?:notice period|time until you can start|how soon can you start)\b/u,
    mapping: { answerKind: "fact", factKey: "notice_period" },
  },
  {
    pattern:
      /\b(?:start date|earliest start|available to start|when can you start|start within)\b/u,
    mapping: { answerKind: "fact", factKey: "earliest_start" },
  },
  {
    pattern: /\b(?:salary|compensation|pay) (?:expectation|requirement|expectations)\b/u,
    mapping: { answerKind: "fact", factKey: "salary_expectation" },
  },
  {
    pattern: /\b(?:desired|target|expected) (?:salary|compensation|pay)\b/u,
    mapping: { answerKind: "fact", factKey: "salary_expectation" },
  },
  {
    pattern: /\b(?:relocat|willing to move|open to moving)\b/u,
    mapping: { answerKind: "fact", factKey: "willing_relocate" },
  },
  {
    pattern:
      /\b(?:years? (?:of )?(?:professional |relevant |industry )?experience|how many years|years.*experience)\b/u,
    mapping: { answerKind: "fact", factKey: "years_total" },
  },
  {
    pattern: /\b(?:highest (?:level of )?education|highest degree|education level|degree)\b/u,
    mapping: { answerKind: "fact", factKey: "degree_highest" },
  },
  {
    pattern: /\b(?:spoken )?languages? (?:do you speak|spoken|fluency)\b/u,
    mapping: { answerKind: "fact", factKey: "languages" },
  },
  {
    pattern: /\bgender\b/u,
    mapping: { answerKind: "fact", factKey: "eeo_gender" },
  },
  {
    pattern: /\b(?:race|ethnicity)\b/u,
    mapping: { answerKind: "fact", factKey: "eeo_race_ethnicity" },
  },
  {
    pattern: /\b(?:hispanic|latino)\b/u,
    mapping: { answerKind: "fact", factKey: "eeo_hispanic_latino" },
  },
  {
    pattern: /\bveteran\b/u,
    mapping: { answerKind: "fact", factKey: "eeo_veteran" },
  },
  {
    pattern: /\bdisabilit(?:y|ies)\b/u,
    mapping: { answerKind: "fact", factKey: "eeo_disability" },
  },
  {
    pattern:
      /\b(?:why do you want to work|why are you interested|tell us about yourself|describe|cover letter)\b/u,
    mapping: OPEN_TEXT_MAPPING,
  },
];

function mapQuestionByRulesValue(text: string) {
  const folded = text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

  if (SKIP_PATTERN.test(folded)) {
    return SKIP_MAPPING;
  }

  for (const rule of RULES) {
    if (rule.pattern.test(folded)) {
      return rule.mapping;
    }
  }

  if (CONSENT_PATTERN.test(folded)) {
    return CONSENT_MAPPING;
  }

  return null;
}
