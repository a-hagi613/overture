const GREENHOUSE_LABELLED =
  /(?:security|verification)\s+code[^:\n]*:\s*(?<code>[A-Za-z0-9]{8})\b/iu;

const GREENHOUSE_NUMERIC = /(?:security|verification)\s+code\b[^0-9]{0,40}(?<code>\d{8})\b/iu;

export const codePatterns = {
  greenhouse: /^[A-Za-z0-9]{8}$/u,
} as const;

const CLASSIFICATION_RULES = [
  [
    "rejection",
    [
      /unfortunately/iu,
      /not moving forward/iu,
      /other candidates/iu,
      /not selected/iu,
      /decided to (?:move forward|proceed) with other/iu,
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
    ],
  ],
  ["screening", [/phone screen/iu, /recruiter call/iu, /introductory call/iu]],
  [
    "ack",
    [
      /thank you for applying/iu,
      /thanks for applying/iu,
      /we (?:have )?received your application/iu,
      /application (?:has been|was) received/iu,
      /your application to/iu,
    ],
  ],
] as const;

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

export function classifyMail(text: string) {
  for (const [classification, patterns] of CLASSIFICATION_RULES) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return classification;
    }
  }

  return "other";
}
