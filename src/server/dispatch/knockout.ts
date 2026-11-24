/**
 * Deterministic knock-out pre-scan.
 *
 * A posting sometimes states a hard screen in its own copy: authorization to
 * work in one country, no visa sponsorship, a minimum number of years, or a
 * required place of residence. When the candidate's saved Facts clearly fail one
 * of those screens, preparing the Application can only waste LLM spend on an
 * answer that can never be sent. This module reads those screens with fixed
 * patterns in the languages Overture's boards serve and returns a structured
 * skip; it never calls an LLM.
 */

export const KNOCKOUT_CODES = [
  "work_authorization",
  "sponsorship",
  "experience",
  "location",
] as const;

export type KnockoutCode = (typeof KNOCKOUT_CODES)[number];

export interface KnockoutPosting {
  title: string;
  description: string;
  countryCode: string | null;
  locationRaw: string | null;
  workplace: string | null;
}

/**
 * The saved Facts a knock-out screen reads. Country-scoped `work_auth` values
 * are keyed by ISO 3166-1 alpha-2 code, matching the Fact store.
 */
export interface KnockoutProfile {
  sponsorshipRequired: string | null;
  workAuthByCountry: ReadonlyMap<string, string>;
  workAuthUnscoped: string | null;
  yearsTotal: string | null;
  currentCountry: string | null;
  willingRelocate: string | null;
}

export interface KnockoutRules {
  noSponsorship: boolean;
  requiredWorkCountry: string | null;
  minYears: number | null;
  requiredResidenceCountry: string | null;
  /** A remote role cannot be knocked out for the place it asks the team to sit in. */
  remote: boolean;
}

export type KnockoutVerdict =
  | { eligible: true }
  | { eligible: false; code: KnockoutCode; explanation: string; countryName: string | null };

export interface KnockoutSkip {
  outcome: "knockout_ineligible";
  code: KnockoutCode;
  explanation: string;
  statusReason: string;
  rules: KnockoutRules;
}

export function knockoutStatusReason(code: KnockoutCode) {
  return `knockout_${code}`;
}

interface CountryEntry {
  code: string;
  names: readonly string[];
}

const COUNTRIES: readonly CountryEntry[] = [
  { code: "US", names: ["united states", "united states of america", "usa", "u.s.", "u.s.a."] },
  { code: "CA", names: ["canada"] },
  {
    code: "GB",
    names: ["united kingdom", "great britain", "uk", "u.k.", "england", "scotland", "wales"],
  },
  { code: "IE", names: ["ireland", "republic of ireland"] },
  { code: "DE", names: ["germany", "deutschland", "allemagne", "alemania"] },
  { code: "FR", names: ["france", "frankreich", "francia"] },
  { code: "ES", names: ["spain", "espana", "españa", "espagne", "spanien"] },
  { code: "PT", names: ["portugal"] },
  {
    code: "NL",
    names: ["netherlands", "the netherlands", "niederlande", "pays-bas", "paises bajos"],
  },
  { code: "BE", names: ["belgium", "belgique", "belgien", "belgica"] },
  { code: "CH", names: ["switzerland", "schweiz", "suisse", "suiza"] },
  { code: "AT", names: ["austria", "osterreich", "österreich", "autriche"] },
  { code: "IT", names: ["italy", "italien", "italie", "italia"] },
  { code: "PL", names: ["poland", "polen", "pologne", "polonia"] },
  { code: "SE", names: ["sweden", "schweden", "suede", "suède", "suecia"] },
  { code: "NO", names: ["norway", "norwegen", "norvege", "noruega"] },
  { code: "DK", names: ["denmark", "danemark", "dänemark", "dinamarca"] },
  { code: "FI", names: ["finland", "finnland", "finlande", "finlandia"] },
  { code: "AU", names: ["australia", "australien", "australie"] },
  { code: "NZ", names: ["new zealand", "neuseeland", "nouvelle-zelande", "nueva zelanda"] },
  { code: "JP", names: ["japan", "japon", "japón", "日本"] },
  { code: "BR", names: ["brazil", "brasil", "bresil", "brésil"] },
  { code: "MX", names: ["mexico", "mexico", "mexique", "méxico"] },
  { code: "IN", names: ["india", "indien", "inde"] },
  { code: "SG", names: ["singapore", "singapur", "singapour"] },
];

const CODE_BY_NAME = COUNTRIES.flatMap((entry) =>
  entry.names.map((name) => ({ code: entry.code, name }) as const),
).toSorted((left, right) => right.name.length - left.name.length);

const NAME_BY_CODE = new Map(COUNTRIES.map((entry) => [entry.code, entry.names[0] ?? entry.code]));

const DISPLAY_BY_CODE = new Map([
  ["US", "the United States"],
  ["GB", "the United Kingdom"],
  ["NL", "the Netherlands"],
]);

function escapePattern(raw: string) {
  return raw.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function countryPattern(name: string) {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)
    ? new RegExp(escapePattern(name), "iu")
    : new RegExp(String.raw`(?<![\p{L}\p{N}])${escapePattern(name)}(?![\p{L}\p{N}])`, "iu");
}

const COUNTRY_PATTERNS = CODE_BY_NAME.map((entry) => ({
  code: entry.code,
  pattern: countryPattern(entry.name),
}));

/**
 * Finds the first country a piece of text names, in any supported language.
 *
 * @param text The posting copy or a captured place phrase.
 * @returns The ISO 3166-1 alpha-2 code, or `null` when no country is named.
 */
export function countryFromText(text: string) {
  const raw = text.trim();

  if (/^[A-Za-z]{2}$/u.test(raw) && NAME_BY_CODE.has(raw.toUpperCase())) {
    return raw.toUpperCase();
  }

  if (/\b(?:u\.s\.a?|usa|the\s+us|united\s+states(?:\s+of\s+america)?)\b/iu.test(raw)) {
    return "US";
  }

  const folded = text.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase();

  for (const candidate of COUNTRY_PATTERNS) {
    if (candidate.pattern.test(folded)) {
      return candidate.code;
    }
  }

  if (/日本/u.test(text)) {
    return "JP";
  }

  return null;
}

const NO_SPONSORSHIP_PATTERNS: readonly RegExp[] = [
  /\bno\s+(?:visa\s+|work\s+)?sponsorship\b/iu,
  /\b(?:unable|cannot|can(?:no|')t|not able)\s+to\s+(?:offer\s+)?sponsor\b/iu,
  /\b(?:do|does)\s+not\s+(?:offer|provide)\s+(?:visa\s+)?sponsorship\b/iu,
  /\bvisa\s+sponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/iu,
  /\bwithout\s+(?:the\s+need\s+for\s+)?(?:visa\s+)?sponsorship\b/iu,
  /\bsorry,?\s+(?:we\s+)?(?:cannot|can't|are unable to)\s+sponsor\b/iu,
  /\bkeine[sn]?\s+(?:visum|visa)?\s*sponsor/iu,
  /\bkeine\s+unterstutzung\s+bei\s+der\s+arbeitserlaubnis\b/iu,
  /\bpas\s+de\s+(?:parrainage|sponsorisation)\b/iu,
  /\bne\s+(?:sponsorisons|parrainons)\s+pas\b/iu,
  /\bsin\s+patrocinio\b/iu,
  /\bno\s+(?:patrocinamos|ofrecemos\s+patrocinio)\b/iu,
  /スポンサー(?:は)?(?:しません|いたしません|対象外)/u,
];

const WORK_COUNTRY_PATTERNS: readonly RegExp[] = [
  /(?:must|should|need)\s+(?:to\s+)?(?:be\s+)?(?:legally\s+)?(?:authori[sz]ed|authorised|eligible|entitled|able)\s+to\s+work\s+in\s+(?<place>[^.;\n]{2,40})/iu,
  /\bright\s+to\s+work\s+in\s+(?<place>[^.;\n]{2,40})/iu,
  /\bwork\s+authori[sz]ation\s+(?:in|for)\s+(?<place>[^.;\n]{2,40})/iu,
  /\barbeitsberechtigung\s+(?:fur|für|in)\s+(?<place>[^.;\n]{2,40})/iu,
  /\bautorisation\s+de\s+travail\s+(?:en|au|aux|a|à)\s+(?<place>[^.;\n]{2,40})/iu,
  /\bautorizacion\s+para\s+trabajar\s+en\s+(?<place>[^.;\n]{2,40})/iu,
  /(?<place>日本)(?:国内)?での(?:就労|労働)資格/u,
];

const MIN_YEARS_PATTERNS: readonly RegExp[] = [
  /\b(?:at\s+least|minimum(?:\s+of)?|min\.?)\s+(?<years>\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|professional\s+|hands-on\s+|proven\s+)?experience\b/iu,
  /\b(?<years>\d{1,2})\+\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|hands-on\s+|proven\s+)?experience\b/iu,
  /\b(?:mindestens|min\.)\s+(?<years>\d{1,2})\s*(?:jahre|jahren)\b[^.;\n]{0,40}\berfahrung\b/iu,
  /\b(?:au\s+moins|minimum)\s+(?<years>\d{1,2})\s*(?:ans|annees)\b[^.;\n]{0,40}\bexperience\b/iu,
  /\b(?:al\s+menos|minimo)\s+(?<years>\d{1,2})\s*anos?\b[^.;\n]{0,40}\bexperiencia\b/iu,
  /(?<years>\d{1,2})\s*年以上[^。\n]{0,20}経験/u,
];

const RESIDENCE_PATTERNS: readonly RegExp[] = [
  /\bmust\s+(?:be\s+)?(?:based|located|reside|living|live)\s+in\s+(?<place>[^.;\n]{2,50})/iu,
  /\b(?:residency|residence)\s+(?:in|required\s+in)\s+(?<place>[^.;\n]{2,50})/iu,
  /\bwohnhaft\s+(?:in|im)\s+(?<place>[^.;\n]{2,50})/iu,
  /\b(?:domicile|resider|résider)\s+(?:a|à|en|au)\s+(?<place>[^.;\n]{2,50})/iu,
  /\b(?:residir|domicilio)\s+en\s+(?<place>[^.;\n]{2,50})/iu,
];

const PREFERRED_PATTERN =
  /\bpreferred\b|\bdesired\b|\ba\s+plus\b|\bnice\s+to\s+have\b|\bideally\b/iu;

function preferredContext(text: string, index: number) {
  const window = text.slice(Math.max(0, index - 40), index + 60);

  return PREFERRED_PATTERN.test(window);
}

function firstMatch(patterns: readonly RegExp[], text: string) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match !== null) {
      return match;
    }
  }

  return null;
}

/**
 * Reads the hard screens a posting states about itself. Only explicit wording is
 * trusted: a posting that never talks about sponsorship, years or residency
 * produces no rule and therefore never skips.
 *
 * @param posting The posting's title and description copy.
 * @returns The parsed rules.
 */
export function parseKnockoutRules(posting: KnockoutPosting) {
  const text = `${posting.title}\n${posting.description}`
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase();

  const noSponsorship = NO_SPONSORSHIP_PATTERNS.some((pattern) => pattern.test(text));

  const workMatch = firstMatch(WORK_COUNTRY_PATTERNS, text);

  const requiredWorkCountry =
    (workMatch?.groups?.["place"] === undefined
      ? null
      : countryFromText(workMatch.groups["place"])) ?? null;

  const yearsMatch = firstMatch(MIN_YEARS_PATTERNS, text);

  const yearsIndex = yearsMatch?.index ?? -1;

  const parsedYears =
    yearsMatch?.groups?.["years"] === undefined || preferredContext(text, yearsIndex)
      ? null
      : Number(yearsMatch.groups["years"]);

  const minYears = parsedYears === null || !Number.isFinite(parsedYears) ? null : parsedYears;

  const residenceMatch = firstMatch(RESIDENCE_PATTERNS, text);

  const requiredResidenceCountry =
    (residenceMatch?.groups?.["place"] === undefined
      ? null
      : countryFromText(residenceMatch.groups["place"])) ?? null;

  return {
    minYears,
    noSponsorship,
    remote: posting.workplace === "remote",
    requiredResidenceCountry,
    requiredWorkCountry,
  };
}

const NEGATIVE_WORK_AUTH =
  /^(?:no|not|false|none)\b|\bnot\s+authori[sz]ed\b|\bno\s+(?:work\s+)?authori[sz]ation\b|\bneed\s+(?:a\s+)?(?:visa|sponsorship)\b|\brequire\s+(?:a\s+)?(?:visa|sponsorship)\b|\bvisa\s+required\b/iu;

const AFFIRMATIVE_SPONSORSHIP =
  /^(?:yes|true)\b|\brequire\b|\brequired\b|\bneed\b|\bwill\s+require\b|\bsponsorship\s+needed\b/iu;

const NEGATIVE_SPONSORSHIP =
  /^(?:no|false)\b|\bdo\s+not\b|\bdon'?t\b|\bnot\s+require\b|\bno\s+sponsorship\b|\bwithout\b/iu;

const NEGATIVE_RELOCATION =
  /^(?:no|false)\b|\bnot\s+willing\b|\bunwilling\b|\bcannot\b|\bcan't\b|\bnot\s+open\b|\bno\s+relocation\b/iu;

export function parseYearsValue(raw: string | null) {
  if (raw === null) {
    return null;
  }

  const match = /(?<years>\d{1,2}(?:[.,]\d)?)/u.exec(raw.replaceAll(",", ""));

  if (match?.groups?.["years"] === undefined) {
    return null;
  }

  const years = Number(match.groups["years"].replace(",", "."));

  return Number.isFinite(years) ? years : null;
}

function countryName(code: string) {
  const override = DISPLAY_BY_CODE.get(code);

  if (override !== undefined) {
    return override;
  }

  return (NAME_BY_CODE.get(code) ?? code).replaceAll(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function workAuthFor(profile: KnockoutProfile, country: string) {
  return (
    profile.workAuthByCountry.get(country) ??
    (profile.currentCountry === country ? profile.workAuthUnscoped : null)
  );
}

function sponsorshipVerdict(rules: KnockoutRules, profile: KnockoutProfile) {
  if (!rules.noSponsorship) {
    return null;
  }

  const required = profile.sponsorshipRequired;

  if (required === null || !AFFIRMATIVE_SPONSORSHIP.test(required)) {
    return null;
  }

  if (NEGATIVE_SPONSORSHIP.test(required)) {
    return null;
  }

  const country = rules.requiredWorkCountry ?? profile.currentCountry;

  return {
    code: "sponsorship",
    countryName: country === null ? null : countryName(country),
    eligible: false,
    explanation:
      country === null
        ? "This role says it does not offer visa sponsorship, which your profile requires."
        : `This role does not offer visa sponsorship in ${countryName(country)}, which your profile requires.`,
  } satisfies KnockoutVerdict;
}

function workAuthorizationVerdict(rules: KnockoutRules, profile: KnockoutProfile) {
  const country = rules.requiredWorkCountry;

  if (country === null) {
    return null;
  }

  const auth = workAuthFor(profile, country);

  if (auth === null || !NEGATIVE_WORK_AUTH.test(auth)) {
    return null;
  }

  return {
    code: "work_authorization",
    countryName: countryName(country),
    eligible: false,
    explanation: `This role requires authorization to work in ${countryName(country)}, which your saved work authorization says you do not have.`,
  } satisfies KnockoutVerdict;
}

function experienceVerdict(rules: KnockoutRules, profile: KnockoutProfile) {
  if (rules.minYears === null) {
    return null;
  }

  const years = parseYearsValue(profile.yearsTotal);

  if (years === null || years >= rules.minYears) {
    return null;
  }

  return {
    code: "experience",
    countryName: null,
    eligible: false,
    explanation: `This role asks for at least ${String(rules.minYears)} years of experience; your profile lists ${profile.yearsTotal ?? "fewer"}.`,
  } satisfies KnockoutVerdict;
}

function locationVerdict(rules: KnockoutRules, profile: KnockoutProfile) {
  if (rules.remote) {
    return null;
  }

  const country = rules.requiredResidenceCountry;

  if (country === null || profile.currentCountry === null || profile.currentCountry === country) {
    return null;
  }

  const willingness = profile.willingRelocate;

  if (willingness === null || !NEGATIVE_RELOCATION.test(willingness)) {
    return null;
  }

  return {
    code: "location",
    countryName: countryName(country),
    eligible: false,
    explanation: `This role requires living in ${countryName(country)} and your profile says you are not open to relocating there.`,
  } satisfies KnockoutVerdict;
}

/**
 * Applies the parsed screens to the saved Facts. Unknown facts never skip: only
 * a clear contradiction counts.
 *
 * @param rules The screens the posting states.
 * @param profile The saved Facts.
 * @returns The eligible verdict, or the first failed screen with its explanation.
 */
export function evaluateKnockout(rules: KnockoutRules, profile: KnockoutProfile) {
  return (
    sponsorshipVerdict(rules, profile) ??
    workAuthorizationVerdict(rules, profile) ??
    experienceVerdict(rules, profile) ??
    locationVerdict(rules, profile) ?? { eligible: true }
  );
}

/**
 * Runs the whole pre-scan for one posting and one candidate profile. The result
 * is a plain data outcome, so the caller can skip the Application before any
 * LLM request is built.
 *
 * @param input The posting copy and the candidate's saved Facts.
 * @returns The skip outcome, or `null` when the Application stays eligible.
 */
export function knockoutPreScan(input: { posting: KnockoutPosting; profile: KnockoutProfile }) {
  const rules = parseKnockoutRules(input.posting);
  const verdict = evaluateKnockout(rules, input.profile);

  if (verdict.eligible) {
    return null;
  }

  return {
    code: verdict.code,
    explanation: verdict.explanation,
    outcome: "knockout_ineligible",
    rules,
    statusReason: knockoutStatusReason(verdict.code),
  } satisfies KnockoutSkip;
}

interface FactIndexLike {
  unscoped: ReadonlyMap<string, string>;
  scoped: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * Builds the profile view a knock-out screen reads from the indexed Facts.
 *
 * @param facts The Fact index preparation already loaded.
 * @returns The profile view, with `null` for every Fact the candidate has not saved.
 */
export function knockoutProfileFromFacts(facts: FactIndexLike) {
  const currentCountry = facts.unscoped.get("current_country") ?? null;

  return {
    currentCountry: currentCountry === null ? null : (countryFromText(currentCountry) ?? null),
    sponsorshipRequired: facts.unscoped.get("sponsorship_required") ?? null,
    willingRelocate: facts.unscoped.get("willing_relocate") ?? null,
    workAuthByCountry: facts.scoped.get("work_auth") ?? new Map<string, string>(),
    workAuthUnscoped: facts.unscoped.get("work_auth") ?? null,
    yearsTotal: facts.unscoped.get("years_total") ?? null,
  };
}
