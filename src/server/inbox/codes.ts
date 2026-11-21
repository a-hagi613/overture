const GREENHOUSE_LABELLED =
  /(?:security|verification)\s+code[^:\n]*:\s*(?<code>[A-Za-z0-9]{8})\b/iu;

const GREENHOUSE_NUMERIC = /(?:security|verification)\s+code\b[^0-9]{0,40}(?<code>\d{8})\b/iu;

export const codePatterns = {
  greenhouse: /^[A-Za-z0-9]{8}$/u,
} as const;

export type MailClassification =
  | "ack"
  | "code"
  | "rejection"
  | "screening"
  | "interview"
  | "offer"
  | "other";

export type MailLanguage = "en" | "de" | "fr";

type ClassificationRule = readonly [MailClassification, readonly RegExp[]];

const ENGLISH_RULES: readonly ClassificationRule[] = [
  [
    "rejection",
    [
      /unfortunately/iu,
      /not moving forward/iu,
      /other candidates/iu,
      /not selected/iu,
      /decided to (?:move forward|proceed) with other/iu,
      /unable to (?:offer|progress)/iu,
    ],
  ],
  ["offer", [/offer of employment/iu, /we are pleased to offer/iu, /job offer/iu]],
  [
    "interview",
    [
      /interview/iu,
      /schedule (?:a|your) (?:call|conversation|meeting)/iu,
      /calendly\.com/iu,
      /goodtime\.io/iu,
      /greenhouse\.io\/scheduling/iu,
      /book (?:a|your) (?:call|time)/iu,
    ],
  ],
  ["screening", [/phone screen/iu, /recruiter call/iu, /introductory call/iu]],
  [
    "ack",
    [
      /thank you for applying/iu,
      /thanks for applying/iu,
      /thank you for your interest in/iu,
      /we (?:have )?received your application/iu,
      /we(?:'ve| have) received your application/iu,
      /application (?:has been|was) received/iu,
      /your application to/iu,
    ],
  ],
];

const GERMAN_RULES: readonly ClassificationRule[] = [
  [
    "rejection",
    [/leider/iu, /nicht weiter/iu, /andere[rn]? kandidat/iu, /abgelehnt/iu, /absage/iu],
  ],
  [
    "offer",
    [
      /stellenangebot/iu,
      /arbeitsangebot/iu,
      /vertragsangebot/iu,
      /arbeitsvertrag/iu,
      /wir freuen uns, Ihnen eine Stelle/iu,
    ],
  ],
  [
    "interview",
    [
      /vorstellungsgespräch/iu,
      /(?:einladung|einladen) (?:zu|zum) (?:einem )?(?:gespräch|interview)/iu,
      /termin (?:für ein|zum) (?:gespräch|interview)/iu,
      /kennenlernen/iu,
    ],
  ],
  ["screening", [/telefoninterview/iu, /erstgespräch/iu, /telefonat/iu]],
  [
    "ack",
    [
      /vielen dank für (?:Ihre|deine) Bewerbung/iu,
      /wir haben (?:Ihre|deine) Bewerbung erhalten/iu,
      /eingang (?:Ihrer|deiner) Bewerbung/iu,
    ],
  ],
];

const FRENCH_RULES: readonly ClassificationRule[] = [
  [
    "rejection",
    [
      /malheureusement/iu,
      /n'avons pas (?:retenu|donné suite)/iu,
      /autre[s]? candidat/iu,
      /candidature n'a pas été retenue/iu,
    ],
  ],
  [
    "offer",
    [
      /offre (?:d'emploi|de poste)/iu,
      /proposition (?:d'embauche|de contrat)/iu,
      /contrat de travail/iu,
    ],
  ],
  [
    "interview",
    [
      /entretien/iu,
      /invitation à un entretien/iu,
      /rendez-vous/iu,
      /planifier (?:un|votre) (?:appel|entretien)/iu,
    ],
  ],
  ["screening", [/préqualification/iu, /entretien téléphonique/iu, /appel téléphonique/iu]],
  [
    "ack",
    [
      /nous avons bien reçu (?:votre|ta) candidature/iu,
      /merci (?:pour votre candidature|d'avoir postulé)/iu,
      /candidature (?:a été|est bien) reçue/iu,
    ],
  ],
];

const ATS_RULES = new Map<string, Partial<Record<MailLanguage, readonly ClassificationRule[]>>>([
  [
    "ashby",
    {
      en: [
        ["ack", [/thanks for applying to/iu, /we(?:'ve| have) received your application/iu]],
        ["interview", [/book (?:a|your) (?:call|time)/iu]],
      ],
    },
  ],
  ["greenhouse", { en: [["ack", [/your application to/iu]]] }],
  [
    "lever",
    {
      en: [
        ["ack", [/thank you for your interest in/iu]],
        ["rejection", [/we (?:have )?decided to proceed with other/iu]],
      ],
    },
  ],
  [
    "personio",
    {
      de: [
        ["ack", [/wir haben (?:Ihre|deine) Bewerbung erhalten/iu]],
        ["rejection", [/leider (?:müssen wir|haben wir)/iu]],
        ["interview", [/(?:Einladung|einladen) zum (?:Interview|Gespräch)/iu]],
      ],
    },
  ],
  [
    "workable",
    {
      en: [
        ["ack", [/we(?:'ve| have) received your application/iu]],
        ["interview", [/availability for (?:a|an) (?:call|interview)/iu]],
      ],
    },
  ],
]);

const GERMAN_HINTS =
  /\b(?:leider|bewerbung|beworben|einladung|gespräch|stelle|absage|angebot|unterlagen)\b/giu;

const FRENCH_HINTS = /\b(?:malheureusement|candidature|entretien|offre|poste|reçu|reçue)\b/giu;

function languageRules(language: MailLanguage) {
  if (language === "de") {
    return GERMAN_RULES;
  }

  if (language === "fr") {
    return FRENCH_RULES;
  }

  return ENGLISH_RULES;
}

function hintCount(text: string, hints: RegExp) {
  return text.match(hints)?.length ?? 0;
}

export function detectMailLanguage(text: string) {
  const german = hintCount(text, GERMAN_HINTS);
  const french = hintCount(text, FRENCH_HINTS);

  if (german > french && german > 0) {
    return "de";
  }

  if (french > german && french > 0) {
    return "fr";
  }

  return "en";
}

export function codeFromText(text: string) {
  const labelled = GREENHOUSE_LABELLED.exec(text);

  if (labelled?.groups?.code !== undefined) {
    return labelled.groups.code;
  }

  const numeric = GREENHOUSE_NUMERIC.exec(text);

  return numeric?.groups?.code ?? null;
}

export function isSupportedCode(code: string) {
  return Object.values(codePatterns).some((pattern) => pattern.test(code));
}

export function classifyMail(text: string, options: { ats?: string | null } = {}) {
  const language = detectMailLanguage(text);

  const rules = [
    ...languageRules(language),
    ...(options.ats === null || options.ats === undefined
      ? []
      : (ATS_RULES.get(options.ats)?.[language] ?? [])),
  ];

  for (const [classification, patterns] of rules) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return classification;
    }
  }

  return "other";
}
