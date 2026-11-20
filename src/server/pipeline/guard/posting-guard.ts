const ZERO_WIDTH = "\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064";
const BIDI = "\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
const BIDI_TAMPER = "\u202D\u202E\u2066\u2067\u2068\u2069";
const FORMAT = "\u00AD\u2028\u2029";
const BOM = "\uFEFF";

const TAG_START = 917_504;
const TAG_END = 917_631;
const VARIATION_START = 65_024;
const VARIATION_END = 65_039;

const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;

const isTagChar = (code: number) => code >= TAG_START && code <= TAG_END;

const INVISIBLE = new Set(
  Array.from(ZERO_WIDTH + BIDI + FORMAT + BOM, (char) => char.codePointAt(0)),
);

const INVISIBLE_NAMES: readonly [string, string][] = [
  ["zero_width", ZERO_WIDTH],
  ["bidi", BIDI],
  ["format", FORMAT],
  ["bom", BOM],
];

const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:[;}"']|$)|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?:[;}"']|$)|color\s*:\s*transparent|clip\s*:\s*rect\(\s*0|clip-path\s*:\s*inset\(\s*100%|(?:left|top|text-indent)\s*:\s*-\d{4,}px/iu;

const PRESTRIP = /<!DOCTYPE[^>]*>|<\?[^>]*\?>/giu;
const COMMENT = /<!--[\s\S]*?(?:--!?>|$)/gu;

const DROP_BLOCKS =
  /<(?<tag>script|style|noscript|svg|template)\b[^>]*>[\s\S]*?(?:<\/\k<tag>\s*>|$)/giu;

const TAG = /<(?<closing>\/?)(?<name>[a-zA-Z][\w:-]*)(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;

const ATTR =
  /(?<name>[^\s=/"'>]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>"']+)))?/gu;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const HTML_HINT = /<\s*(?<tag>html|body|div|p)\b/iu;
const URL = /https?:\/\/[^\s<>"')]+/gu;

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\bignore (?:all|any|the|previous|prior|above|earlier)\b/iu,
  /\b(?:disregard|forget)(?: all| any| the| your| my)? (?:previous|prior|above|earlier|preceding|initial|original|system) (?:instructions?|prompts?)\b/iu,
  /\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b/iu,
  /\bsystem prompt\b/iu,
  /\b(?:do not|don['’]?t|never) tell (?:the user|the candidate)\b/iu,
  /\b(?:do not|don['’]?t|never) (?:mention|reveal|disclose)\b[^.\n]{0,30}\bto the user\b/iu,
  /\b(?:run|execute) the following (?:command|commands|script|code|shell|instruction|instructions|steps)\b/iu,
  /\bas an ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?(?:engineer|developer|researcher|scientist|architect|specialist|lead|consultant|manager|analyst|intern|trainer|expert|strategist|designer|tester|owner|programmer)s?\b)/iu,
  /^\s*(?:assistant|system|user)\s*:/iu,
  /<\|/u,
  /\[INST\]/iu,
  /###\s*(?:system|instruction)/iu,
  /\b(?:curl|wget|ssh|scp)\b/iu,
  /\.env\b/u,
  /settings\.json/iu,
  /allowed-tools/iu,
  /\btool_use\b|\bfunction_call\b/u,
];

const NAMED_ENTITIES: readonly [string, string][] = [
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["hellip", "…"],
  ["lt", "<"],
  ["mdash", "—"],
  ["nbsp", " "],
  ["ndash", "–"],
  ["quot", '"'],
];

const ENTITIES = new Map(NAMED_ENTITIES);

export interface GuardFindings {
  hiddenBlocks: number;
  invisibleChars: Record<string, number>;
  invisibleFlagged: number;
  invisibleText: string[];
  instructionLike: string[];
  hiddenUrls: string[];
  alarming: boolean;
  verdict: string;
}

export interface GuardedPosting {
  text: string;
  safeText: string;
  findings: GuardFindings;
}

function decodeEntities(value: string) {
  return value.replaceAll(
    /&(?:#(?<decimal>\d+)|#[xX](?<hex>[0-9a-fA-F]+)|(?<named>[a-zA-Z]+));/gu,
    (whole, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named !== undefined) {
        return ENTITIES.get(named.toLowerCase()) ?? whole;
      }

      const code = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number(decimal);

      return Number.isFinite(code) && code > 0 && code <= 1_114_111
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}

function fold(value: string) {
  return value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[ \t\f\v\u00A0]+/gu, " ")
    .replaceAll(/ *\n */gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function countIn(value: string, set: string) {
  let count = 0;

  for (const char of value) {
    if (set.includes(char)) {
      count += 1;
    }
  }

  return count;
}

function countTags(value: string) {
  let count = 0;

  for (const char of value) {
    if (isTagChar(char.codePointAt(0) ?? 0)) {
      count += 1;
    }
  }

  return count;
}

function invisibleCounts(value: string) {
  const counts: Record<string, number> = {};

  for (const [name, set] of INVISIBLE_NAMES) {
    const count = countIn(value, set);

    if (count > 0) {
      counts[name] = count;
    }
  }

  const tags = countTags(value);

  if (tags > 0) {
    counts.tag = tags;
  }

  return counts;
}

function stripInvisible(value: string) {
  let stripped = "";

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const variation = code >= VARIATION_START && code <= VARIATION_END;

    if (!INVISIBLE.has(code) && !isTagChar(code) && !variation) {
      stripped += char;
    }
  }

  return stripped;
}

function flaggedInvisible(value: string) {
  const chars: string[] = [];

  for (const char of value) {
    chars.push(char);
  }

  let flagged = 0;

  for (const [index, char] of chars.entries()) {
    if (BIDI_TAMPER.includes(char)) {
      flagged += 1;
      continue;
    }

    if (ZERO_WIDTH.includes(char) || char === BOM) {
      const before = chars[index - 1] ?? "";
      const after = chars[index + 1] ?? "";

      if (/\p{L}/u.test(before) && /\p{L}/u.test(after)) {
        flagged += 1;
      }
    }
  }

  return flagged;
}

function tagText(value: string) {
  const decoded: string[] = [];

  for (const match of value.matchAll(TAG_RUN)) {
    let text = "";

    for (const char of match[0]) {
      const code = (char.codePointAt(0) ?? 0) - TAG_START;

      if (code >= 32 && code < 127) {
        text += String.fromCodePoint(code);
      }
    }

    const trimmed = text.trim();

    if (trimmed !== "") {
      decoded.push(trimmed);
    }
  }

  return decoded;
}

function parseAttributes(raw: string) {
  const attributes = new Map<string, string>();

  for (const match of raw.matchAll(ATTR)) {
    const { groups } = match;

    attributes.set(
      (groups?.name ?? "").toLowerCase(),
      groups?.double ?? groups?.single ?? groups?.bare ?? "",
    );
  }

  return attributes;
}

function isHidden(raw: string) {
  const attributes = parseAttributes(raw);

  if (
    attributes.has("hidden") ||
    (attributes.get("aria-hidden") ?? "").trim().toLowerCase() === "true"
  ) {
    return true;
  }

  const style = decodeEntities(attributes.get("style") ?? "");

  return HIDDEN_STYLE.test(style);
}

function cleanHtml(raw: string) {
  const hiddenParts: string[] = [];
  let hiddenBlocks = 0;

  const collect = (whole: string) => {
    hiddenParts.push(
      decodeEntities(whole.replaceAll(/<!--|--!?>/gu, " ").replaceAll(/<[^>]+>/gu, " ")),
    );
    hiddenBlocks += 1;

    return " ";
  };

  const markup = raw
    .replaceAll(PRESTRIP, " ")
    .replaceAll(COMMENT, collect)
    .replaceAll(DROP_BLOCKS, collect);

  const visible: string[] = [];
  const hiddenBuffer: string[] = [];
  const stack: string[] = [];
  let hiddenAt: number | null = null;
  let position = 0;

  const emit = (value: string) => (hiddenAt === null ? visible : hiddenBuffer).push(value);

  const flushHidden = () => {
    const block = fold(decodeEntities(hiddenBuffer.join("")));

    hiddenBuffer.length = 0;
    hiddenAt = null;

    if (block !== "") {
      hiddenBlocks += 1;
      hiddenParts.push(block);
    }
  };

  const popTo = (index: number) => {
    stack.length = index;

    if (hiddenAt !== null && hiddenAt >= stack.length) {
      flushHidden();
    }
  };

  for (const match of markup.matchAll(TAG)) {
    emit(markup.slice(position, match.index));
    position = match.index + match[0].length;

    const name = (match.groups?.name ?? "").toLowerCase();

    if (BLOCK_TAGS.has(name)) {
      emit("\n");
    }

    if (match.groups?.closing === "/") {
      const index = stack.lastIndexOf(name);

      if (index !== -1) {
        popTo(index);
      }

      continue;
    }

    if (VOID_TAGS.has(name)) {
      continue;
    }

    stack.push(name);

    if (hiddenAt === null && isHidden(match.groups?.attributes ?? "")) {
      hiddenAt = stack.length - 1;
    }
  }

  emit(markup.slice(position));

  if (hiddenAt !== null) {
    flushHidden();
  }

  return {
    text: fold(decodeEntities(visible.join(""))),
    hiddenText: hiddenParts.join("\n"),
    hiddenBlocks,
  };
}

function instructionLines(visible: string, hidden: string) {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const line of [...visible.split("\n"), ...hidden.split("\n")]) {
    const trimmed = line.trim();

    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }

    if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      seen.add(trimmed);
      lines.push(trimmed.slice(0, 200));
    }
  }

  return lines;
}

function safeTextFor(visible: string, instructionLike: readonly string[]) {
  const flagged = new Set(instructionLike);

  return visible
    .split("\n")
    .filter((line) => !flagged.has(line.trim().slice(0, 200)))
    .join("\n");
}

function plural(count: number, one: string, many: string) {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function verdictFor(findings: Omit<GuardFindings, "alarming" | "verdict">) {
  const alarms: string[] = [];
  const tagCount = findings.invisibleChars.tag ?? 0;

  if (findings.instructionLike.length > 0) {
    alarms.push(
      plural(findings.instructionLike.length, "instruction-like line", "instruction-like lines"),
    );
  }

  if (findings.invisibleFlagged > 0) {
    alarms.push(
      plural(
        findings.invisibleFlagged,
        "invisible character inside words",
        "invisible characters inside words",
      ),
    );
  }

  if (tagCount > 0) {
    alarms.push(plural(tagCount, "tag character", "tag characters"));
  }

  if (findings.invisibleText.length > 0) {
    alarms.push(
      plural(
        findings.invisibleText.length,
        "string spelled in invisible characters",
        "strings spelled in invisible characters",
      ),
    );
  }

  const removed: string[] = [];

  if (findings.hiddenBlocks > 0) {
    removed.push(plural(findings.hiddenBlocks, "hidden block", "hidden blocks"));
  }

  if (findings.hiddenUrls.length > 0) {
    removed.push(plural(findings.hiddenUrls.length, "hidden URL", "hidden URLs"));
  }

  if (alarms.length > 0) {
    const line = `posting_guard: ${alarms.join(", ")}`;

    if (removed.length > 0) {
      return { alarming: true, verdict: `${line} (${removed.join(" and ")} removed)` };
    }

    return { alarming: true, verdict: line };
  }

  if (removed.length > 0) {
    return { alarming: false, verdict: `posting_guard: clean (${removed.join(" and ")} removed)` };
  }

  return { alarming: false, verdict: "posting_guard: clean" };
}

export function guardPosting(raw: string, mode: "html" | "text" | "auto" = "auto") {
  let resolved = mode;

  if (mode === "auto") {
    resolved = HTML_HINT.test(raw) ? "html" : "text";
  }

  const cleaned =
    resolved === "html" ? cleanHtml(raw) : { text: raw, hiddenText: "", hiddenBlocks: 0 };

  const visible = fold(stripInvisible(cleaned.text));
  const hidden = fold(stripInvisible(cleaned.hiddenText));
  const invisibleChars = invisibleCounts(`${cleaned.text}\n${cleaned.hiddenText}`);
  const invisibleText = tagText(`${raw}\n${cleaned.hiddenText}`);
  const hiddenUrls: string[] = [];
  const seenUrls = new Set<string>();

  for (const match of hidden.matchAll(URL)) {
    if (!seenUrls.has(match[0])) {
      seenUrls.add(match[0]);
      hiddenUrls.push(match[0]);
    }
  }

  const instructionLike = instructionLines(visible, `${hidden}\n${invisibleText.join("\n")}`);

  const base = {
    hiddenBlocks: cleaned.hiddenBlocks,
    hiddenUrls,
    invisibleChars,
    invisibleFlagged: flaggedInvisible(`${cleaned.text}\n${cleaned.hiddenText}`),
    invisibleText,
    instructionLike,
  };

  return {
    text: visible,
    safeText: safeTextFor(visible, instructionLike),
    findings: { ...base, ...verdictFor(base) },
  } satisfies GuardedPosting;
}
