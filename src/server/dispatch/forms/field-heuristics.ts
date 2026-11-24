import type { FactKey } from "../../../shared/facts.ts";

/**
 * The semantic kinds of form field the readers care about, independent of the
 * employer's copy. One kind can answer several Fact keys; the map below keeps
 * that translation in one place.
 */
export const FIELD_KINDS = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "location",
  "linkedin_url",
  "github_url",
  "website_url",
  "work_auth",
  "sponsorship_required",
  "salary_expectation",
  "years_total",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** The Fact each field kind fills, when the profile keeps one. */
export const FACT_KEY_BY_FIELD_KIND: Readonly<Record<FieldKind, FactKey | null>> = {
  email: "email",
  first_name: "legal_name",
  full_name: "legal_name",
  github_url: "github_url",
  last_name: "legal_name",
  linkedin_url: "linkedin_url",
  location: "current_city",
  phone: "phone",
  salary_expectation: "salary_expectation",
  sponsorship_required: "sponsorship_required",
  website_url: "website_url",
  work_auth: "work_auth",
  years_total: "years_total",
};

interface FieldLabelRule {
  kind: FieldKind;
  pattern: RegExp;
}

const LABEL_RULES: readonly FieldLabelRule[] = [
  { kind: "email", pattern: /\be ?mail\b|\bemail address\b|\bcourriel\b|\bcorreo\b|\be post\b/u },
  {
    kind: "phone",
    pattern:
      /\bphone\b|\btelephone\b|\bmobile\b|\btelefon\b|\btel\b|\btéléphone\b|\btelefono\b|\bcelular\b/u,
  },
  { kind: "linkedin_url", pattern: /\blinked ?in\b/u },
  { kind: "github_url", pattern: /\bgit ?hub\b/u },
  {
    kind: "website_url",
    pattern:
      /\bwebsite\b|\bweb site\b|\bportfolio\b|\bwebseite\b|\bsite web\b|\bsitio web\b|\bhomepage\b/u,
  },
  {
    kind: "sponsorship_required",
    pattern: /\bsponsor|\bvisa\b|\barbeitsvisum\b|\bvisum\b|\bvisa de travail\b|\bpatrocinio\b/u,
  },
  {
    kind: "work_auth",
    pattern:
      /\bwork authori[sz]ation\b|\bauthori[sz]ed to work\b|\beligible to work\b|\bright to work\b|\bwork permit\b|\barbeitsberechtigung\b|\barbeitserlaubnis\b|\bautorisation de travail\b|\bpermis de travail\b|\bautorizacion para trabajar\b|\bpermiso de trabajo\b/u,
  },
  {
    kind: "salary_expectation",
    pattern: /\bsalary\b|\bcompensation\b|\bgehalt|\bsalaire\b|\bsalario\b|\bremuneration\b/u,
  },
  {
    kind: "years_total",
    pattern:
      /\byears? of experience\b|\bberufserfahrung\b|\bannées? d experience\b|\banos de experiencia\b/u,
  },
  {
    kind: "location",
    pattern:
      /\bcity\b|\blocation\b|\bwhere do you live\b|\bstadt\b|\bwohnort\b|\bville\b|\bciudad\b|\bdireccion\b/u,
  },
  {
    kind: "first_name",
    pattern: /\bfirst name\b|\bgiven name\b|\bforename\b|\bvorname\b|\bprenom\b|\bprimer nombre\b/u,
  },
  {
    kind: "last_name",
    pattern:
      /\blast name\b|\bfamily name\b|\bsurname\b|\bnachname\b|\bnom de famille\b|\bapellidos?\b/u,
  },
  {
    kind: "full_name",
    pattern:
      /^(?:full|legal) name$|^name$|^nombre$|\bvollstandiger name\b|\bnom complet\b|\bnombre completo\b/u,
  },
];

const JAPANESE_RULES: readonly FieldLabelRule[] = [
  { kind: "email", pattern: /メール|Eメール/iu },
  { kind: "phone", pattern: /電話|携帯/iu },
  { kind: "full_name", pattern: /氏名|お名前|姓名/u },
  { kind: "last_name", pattern: /姓|苗字/u },
  { kind: "first_name", pattern: /名前/u },
  { kind: "location", pattern: /住所|所在地|居住地|都道府県/u },
  { kind: "linkedin_url", pattern: /LinkedIn/iu },
  { kind: "website_url", pattern: /ポートフォリオ|Webサイト|ウェブサイト/iu },
  { kind: "work_auth", pattern: /就労資格|労働許可|就労ビザ/u },
  { kind: "sponsorship_required", pattern: /スポンサー|ビザ/u },
  { kind: "salary_expectation", pattern: /給与|年収|希望給与/u },
  { kind: "years_total", pattern: /経験年数|実務経験/u },
];

/**
 * Folds a label the way Chromium's label matching does: compatibility
 * decomposition, accents removed, lower-cased, punctuation collapsed to single
 * spaces.
 *
 * @param raw The label text a board printed.
 * @returns The folded label.
 */
export function foldFieldLabel(raw: string) {
  return raw
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * Classifies one form label into the field kind Overture can answer.
 *
 * @param raw The label text a board printed.
 * @returns The field kind, or `null` when no rule is confident.
 */
export function classifyFieldLabel(raw: string) {
  const folded = foldFieldLabel(raw);

  if (folded === "") {
    return null;
  }

  for (const rule of JAPANESE_RULES) {
    if (rule.pattern.test(raw)) {
      return rule.kind;
    }
  }

  for (const rule of LABEL_RULES) {
    if (rule.pattern.test(folded)) {
      return rule.kind;
    }
  }

  return null;
}

/**
 * Returns the Fact key that answers a field kind, so a reader or adapter can
 * reuse the same catalog as the rules mapper.
 *
 * @param kind The classified field kind.
 * @returns The fact key, or `null` when the kind has no stored Fact.
 */
export function factKeyForFieldKind(kind: FieldKind) {
  return FACT_KEY_BY_FIELD_KIND[kind];
}
