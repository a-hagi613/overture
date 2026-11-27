import type { AnswerKind } from "../../shared/questions.ts";

import {
  classifyFieldLabel,
  classifyFieldName,
  factKeyForFieldKind,
} from "../dispatch/forms/field-heuristics.ts";

export interface RuleMapping {
  answerKind: AnswerKind;
  factKey: string | null;
}

const SKIP_MAPPING: RuleMapping = { answerKind: "skip", factKey: null };

const CONSENT_MAPPING: RuleMapping = { answerKind: "consent", factKey: null };

const OPEN_TEXT_MAPPING: RuleMapping = { answerKind: "open_text", factKey: null };

export const mapQuestionByRules: (text: string) => RuleMapping | null = mapQuestionByRulesValue;

const TEMPLATE_MARKERS: readonly RegExp[] = [
  /_{2,}/u,
  /\boptional to include\b/u,
  /\bplaceholder\b/u,
  /\btbd\b|\bto be (?:confirmed|determined)\b/u,
  /\bxxx+\b/u,
  /\{\{\s*[\p{L}\p{N}_]+\s*\}\}/u,
  /\[\s*[\p{L}\p{N}_ ]{0,40}(?:insert|enter|company|office|location|city)\b/u,
];

/**
 * Whether a board's question text still carries its own editing template, such
 * as an unfilled `_____` blank or an "OPTIONAL TO INCLUDE" marker. Such a
 * question is never asked of the person: an answer we cannot give from confirmed
 * facts is left empty instead.
 *
 * @param text The question text a board printed.
 * @returns true when the text is a template leftover rather than a real question.
 */
export function isTemplateLeftover(text: string) {
  return TEMPLATE_MARKERS.some((pattern) => pattern.test(text));
}

/**
 * Maps one control name when the board's label carried no meaning, so an
 * identity field is still answered from its confirmed Fact on every system.
 *
 * @param fieldName The control name a board printed, or null when it has none.
 * @returns The mapping, or `null` when the name is not a known identity control.
 */
export function mapIdentityFieldName(fieldName: string | null) {
  const kind = classifyFieldName(fieldName);

  if (kind === null) {
    return null;
  }

  const factKey = factKeyForFieldKind(kind);

  return factKey === null ? null : { answerKind: "fact" as const, factKey };
}

const SKIP_PATTERN =
  /\b(?:whatsapp|sms|text messages|marketing|newsletter|promotion|job alerts|talent pool|future opportunities|opt in|opt-in)\b/u;

const CONSENT_PATTERN =
  /\b(?:privacy|data processing|terms|acknowledge|acknowledgement|consent|double check|double-check|accuracy|accurate)\b/u;

const RULES: readonly { pattern: RegExp; mapping: RuleMapping }[] = [
  {
    pattern: /\b(?:birthday|date of birth|geburtsdatum)\b/u,
    mapping: SKIP_MAPPING,
  },
  {
    pattern: /\bcountry or countries you anticipate (?:working|to work)\b/u,
    mapping: { answerKind: "target", factKey: "target_countries" },
  },
  {
    pattern: /\b(?:option to work from a remote location|plan to work remotely|work remotely)\b/u,
    mapping: { answerKind: "target", factKey: "target_workplace" },
  },
  {
    pattern:
      /\bopen to working from\b.*\boffice\b|\bwork out of\b.*\boffice\b|\bhybrid schedule\b/u,
    mapping: { answerKind: "target", factKey: "target_workplace" },
  },
  {
    pattern: /\bwilling to relocate\b|\bcurrently located in one of\b.*\bhub/u,
    mapping: { answerKind: "target", factKey: "target_relocation" },
  },
  {
    pattern: /\bever been employed by\b|\bever worked (?:at|for|by)\b/u,
    mapping: { answerKind: "derived", factKey: "employed_by_company" },
  },
  {
    pattern: /\blive in one of the following states\b|\breside in one of\b.*\bstates\b/u,
    mapping: { answerKind: "derived", factKey: "us_state_residence" },
  },
  {
    pattern: /\bcity state and country\b/u,
    mapping: { answerKind: "derived", factKey: "city_region_country" },
  },
  {
    pattern: /\b(?:city and state|city state)\b/u,
    mapping: { answerKind: "derived", factKey: "city_region" },
  },
  {
    pattern:
      /\b(?:current or previous|current|present|previous|most recent)\s+(?:job|role|position)\s+title\b|\b(?:job|role|position) title\b/u,
    mapping: { answerKind: "fact", factKey: "current_job_title" },
  },
  {
    pattern:
      /\b(?:which|what)\b.*\b(?:role|position|job|function|field)\b.*\bcategory\b|\bcategory\b.*\b(?:match|matches|describe|describes|best)\b/u,
    mapping: { answerKind: "derived", factKey: "role_category" },
  },
  {
    pattern: /\b(?:how|where) did you (?:first )?(?:hear|find out|learn) about\b/u,
    mapping: { answerKind: "fact", factKey: "how_did_you_hear" },
  },
  {
    pattern: /\blegal name\b/u,
    mapping: { answerKind: "fact", factKey: "legal_name" },
  },
  {
    pattern: /\bcitizenship\b|\bare you a (?:citizen|national)\b|\bcountry are you a citizen\b/u,
    mapping: { answerKind: "derived", factKey: "work_auth_status" },
  },
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
    pattern: /^location$/u,
    mapping: { answerKind: "fact", factKey: "current_city" },
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
      /\b(?:current|present|most recent)\s+(?:company|employer|organisation|organization)\b|\b(?:company|employer) name\b/u,
    mapping: { answerKind: "fact", factKey: "current_employer" },
  },
  {
    pattern:
      /\b(?:current or previous|current or most recent|current|present|previous|most recent)\s+employer\b|\bpresently employed\b|\bwho do you work for\b/u,
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
    pattern:
      /\benglish\b.*\b(?:fluen|proficien|speak|speaking|spoken|written|read|business level)\b|\b(?:fluen|proficien)\w*\b.*\benglish\b/u,
    mapping: { answerKind: "derived", factKey: "english_fluency" },
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

  const multiLingualKind = classifyFieldLabel(text);

  if (multiLingualKind !== null) {
    return { answerKind: "fact" as const, factKey: factKeyForFieldKind(multiLingualKind) };
  }

  return null;
}
