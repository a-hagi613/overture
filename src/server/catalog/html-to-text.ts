const NAMED_ENTITY_PAIRS: [string, string][] = [
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["agrave", "à"],
  ["aacute", "á"],
  ["acirc", "â"],
  ["atilde", "ã"],
  ["auml", "ä"],
  ["aring", "å"],
  ["aelig", "æ"],
  ["ccedil", "ç"],
  ["egrave", "è"],
  ["eacute", "é"],
  ["ecirc", "ê"],
  ["euml", "ë"],
  ["igrave", "ì"],
  ["iacute", "í"],
  ["icirc", "î"],
  ["iuml", "ï"],
  ["ntilde", "ñ"],
  ["ograve", "ò"],
  ["oacute", "ó"],
  ["ocirc", "ô"],
  ["ouml", "ö"],
  ["oslash", "ø"],
  ["ugrave", "ù"],
  ["uacute", "ú"],
  ["ucirc", "û"],
  ["uuml", "ü"],
  ["yacute", "ý"],
  ["yuml", "ÿ"],
  ["szlig", "ß"],
  ["deg", "°"],
  ["hellip", "…"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["middot", "·"],
  ["euro", "€"],
];

const NAMED_ENTITIES = new Map<string, string>(NAMED_ENTITY_PAIRS);

const CASE_INSENSITIVE_NAMES: ReadonlySet<string> = new Set<string>([
  "amp",
  "lt",
  "gt",
  "quot",
  "apos",
  "nbsp",
]);

function isEmittableCodePoint(code: number) {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 32 && code <= 55_295) ||
    (code >= 57_344 && code <= 65_533) ||
    (code >= 65_536 && code <= 1_114_111)
  );
}

function decodeHexEntity(body: string) {
  const code = Number.parseInt(body.slice(2), 16);

  return Number.isFinite(code) && isEmittableCodePoint(code) ? String.fromCodePoint(code) : null;
}

function decodeDecimalEntity(body: string) {
  const code = Math.trunc(Number(body.slice(1)));

  return Number.isFinite(code) && isEmittableCodePoint(code) ? String.fromCodePoint(code) : null;
}

function decodeNamedEntity(body: string) {
  const exact = NAMED_ENTITIES.get(body);

  if (exact !== undefined) {
    return exact;
  }

  const lower = body.toLowerCase();

  return CASE_INSENSITIVE_NAMES.has(lower) ? (NAMED_ENTITIES.get(lower) ?? null) : null;
}

function decodeEntities(value: string) {
  return value.replaceAll(/&(?<body>#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/gu, (match) => {
    const body = /&(?<inner>.*);/u.exec(match)?.groups?.inner ?? match;

    if (body.startsWith("#x") || body.startsWith("#X")) {
      return decodeHexEntity(body) ?? match;
    }

    if (body.startsWith("#")) {
      return decodeDecimalEntity(body) ?? match;
    }

    return decodeNamedEntity(body) ?? match;
  });
}

export const DESCRIPTION_CAP = 20_000;

const HTML_TAG_RE = /<(?=[a-z/!?])(?:[^>"']|"[^"]*"|'[^']*')+>/giu;

const HTML_MEDIA_RE =
  /<(?<tag>script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\k<tag>\s*>/giu;

function stripMarkup(content: string) {
  return content.replaceAll(HTML_MEDIA_RE, " ").replaceAll(HTML_TAG_RE, " ");
}

export function htmlToText(content: string | null, cap: number = DESCRIPTION_CAP) {
  if (content === null || content.length === 0) {
    return null;
  }

  const decoded = decodeEntities(stripMarkup(content));
  const decodedTwice = decodeEntities(stripMarkup(decoded));

  return stripMarkup(decodedTwice)
    .replaceAll(/<(?=[/]?[a-z!?])/giu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, cap);
}
