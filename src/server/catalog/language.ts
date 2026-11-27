const functionWords: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "en",
    "the and of to in you will our with for team work experience about that this we are is be as on at an or your from have has can all more not who what where when why how join role responsibilities requirements benefits come per based other".split(
      " ",
    ),
  ],
  [
    "de",
    "und der die das wir mit für nicht auf den sich oder auch eine einen einem eines als ist sind im in zu von bei aus dem des werden wird haben hat ihr ihre unser unsere dein deine".split(
      " ",
    ),
  ],
  [
    "fr",
    "les des une vous avec pour dans nous est sont sur aux leur être et le la de du en un une au ce cette ces qui que pas plus nos votre notre nos leurs".split(
      " ",
    ),
  ],
  [
    "es",
    "que los las para con una del por más está sobre equipo como y el la de en un una es son su sus nuestro nuestra tus tus trabajar".split(
      " ",
    ),
  ],
  [
    "it",
    "che per con una dei delle sono nella sulla alla anche come nel e il lo la di da un una è sono nostro nostra tuo tua lavoro".split(
      " ",
    ),
  ],
  [
    "pt",
    "que uma para você não com dos das mais sobre como vamos equipe e o a de em um uma é são seu sua nosso nossa trabalhar".split(
      " ",
    ),
  ],
  [
    "nl",
    "het een van en wij je niet met voor worden werken onze die is zijn op te dat deze dit jouw uw bij als".split(
      " ",
    ),
  ],
  [
    "sv",
    "och att som vi för till med inte ett är ditt teamet vår på en den det du har vi kan samt arbetar".split(
      " ",
    ),
  ],
  [
    "da",
    "og at det som vi for til med ikke er vores arbejde dine på en den du har kan samt arbejder".split(
      " ",
    ),
  ],
  [
    "no",
    "og at det som vi for til med ikke er vår jobb dine oss på en den du har kan samt arbeider".split(
      " ",
    ),
  ],
  [
    "fi",
    "ja on ei että meidän voit työskennellä sekä kun ovat työtä ja se hän me te he ovat kanssa".split(
      " ",
    ),
  ],
  [
    "pl",
    "się jest nie oraz pracy dla będzie twoje nasz ciebie także teamu i w z na to że jak jest są nasza".split(
      " ",
    ),
  ],
  [
    "cs",
    "bude které jsme nás práci pro také svou více budeme naší a v se na to že je jsou náš".split(
      " ",
    ),
  ],
  [
    "tr",
    "için ve olarak dahil senin bizim ile daha olan başvuru ekip bir bu da de çok iş takım".split(
      " ",
    ),
  ],
  [
    "ru",
    "и в не на мы для работы как это по команда или с что вы наш наша ваш ваша это есть".split(" "),
  ],
]);

const LANGUAGE_ORDER = [...functionWords.keys()];

const SCRIPT_LANGUAGES: readonly { language: string; pattern: RegExp }[] = [
  { language: "ja", pattern: /[\u3040-\u30FF]/gu },
  { language: "zh", pattern: /[\u3400-\u4DBF\u4E00-\u9FFF]/gu },
  { language: "ko", pattern: /[\uAC00-\uD7AF]/gu },
  { language: "ar", pattern: /[\u0600-\u06FF]/gu },
  { language: "he", pattern: /[\u0590-\u05FF]/gu },
  { language: "th", pattern: /[\u0E00-\u0E7F]/gu },
  { language: "hi", pattern: /[\u0900-\u097F]/gu },
  { language: "el", pattern: /[\u0370-\u03FF]/gu },
  { language: "ru", pattern: /[\u0400-\u04FF]/gu },
];

const letterPattern = /\p{L}/gu;
const wordPattern = /\p{L}+/gu;

const profileCache = new Map<string, Set<string>>();

function folded(value: string) {
  return value.toLowerCase().normalize("NFKD").replaceAll(/\p{M}/gu, "");
}

function wordsOf(text: string) {
  return folded(text).match(wordPattern) ?? [];
}

function profile(language: string) {
  const cached = profileCache.get(language);

  if (cached !== undefined) {
    return cached;
  }

  const words = new Set<string>();

  const english = new Set(
    (functionWords.get("en") ?? []).map((word) => folded(word)).filter((word) => word.length >= 3),
  );

  for (const word of functionWords.get(language) ?? []) {
    const candidate = folded(word);

    if (candidate.length < 3 || (language !== "en" && english.has(candidate))) {
      continue;
    }

    words.add(candidate);
  }

  profileCache.set(language, words);

  return words;
}

function scriptLanguage(text: string) {
  const letters = (text.match(letterPattern) ?? []).length;

  if (letters === 0) {
    return null;
  }

  for (const { language, pattern } of SCRIPT_LANGUAGES) {
    const count = (text.match(pattern) ?? []).length;

    if (count >= 4 && count / letters > 0.2) {
      return language;
    }
  }

  return null;
}

/**
 * The language a posting is written in, from its script first and then its function words. A script outside the
 * Latin alphabet is decisive even in a short text: kana anywhere means Japanese, Hangul means Korean, and so on, so
 * a Japanese posting is never reported as English. Latin text needs at least 200 characters and two distinct
 * function words, and an ambiguous answer is `null` rather than a guess; `null` is stored as "not stated" and never
 * hides a posting from a user.
 * @param text The posting's description, or any representative prose.
 * @returns An ISO 639-1 language code, or null when the text is too short or too ambiguous.
 */
export function detectLanguage(text: string) {
  const trimmed = text.trim();

  if (trimmed === "") {
    return null;
  }

  const scripted = scriptLanguage(trimmed);

  if (scripted !== null) {
    return scripted;
  }

  if (trimmed.length < 200) {
    return null;
  }

  const words = wordsOf(trimmed);

  if (words.length < 8) {
    return null;
  }

  let best = { language: "en", hits: 0 };

  for (const language of LANGUAGE_ORDER) {
    const known = profile(language);
    const hits = words.filter((word) => known.has(word)).length;

    if (hits > best.hits) {
      best = { language, hits };
    }
  }

  if (best.hits < 2 || best.hits / words.length < 0.02) {
    return null;
  }

  return best.language;
}
