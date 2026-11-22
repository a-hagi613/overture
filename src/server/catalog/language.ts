const functionWords: ReadonlyMap<string, string[]> = new Map([
  ["en", "the and of to in you will our with for team work experience about that".split(" ")],
  ["de", "und der die das wir mit für nicht auf den sich oder auch eine".split(" ")],
  ["fr", "les des une vous avec pour dans nous est sont sur aux leur être".split(" ")],
  ["es", "que los las para con una del por más está sobre equipo como".split(" ")],
  ["it", "che per con una dei delle sono nella sulla alla anche come nel".split(" ")],
  ["pt", "que uma para você não com dos das mais sobre como vamos equipe".split(" ")],
  ["nl", "het een van en wij je niet met voor worden werken onze die".split(" ")],
  ["sv", "och att som vi för till med inte ett är ditt teamet vår".split(" ")],
  ["da", "og at det som vi for til med ikke er vores arbejde dine".split(" ")],
  ["no", "og at det som vi for til med ikke er vår jobb dine oss".split(" ")],
  [
    "fi",
    "ja on ei että meidän voit ty\u00F6skennell\u00E4 sekä kun ovat ty\u00F6t\u00E4".split(" "),
  ],
  ["pl", "się jest nie oraz pracy dla będzie twoje nasz ciebie także teamu".split(" ")],
  ["cs", "bude které jsme nás práci pro také svou více budeme naší".split(" ")],
  ["tr", "için ve olarak dahil senin bizim ile daha olan başvuru ekip".split(" ")],
  ["ru", "и в не на мы для работы как это по команда или".split(" ")],
]);

const cyrillicPattern = /[\u0400-\u04FF]/gu;

const profileCache = new Map<string, Set<string>>();

function trigramsOf(text: string) {
  const padded = ` ${text.toLowerCase()} `;
  const grams = new Set<string>();

  for (let index = 0; index < padded.length - 3; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }

  return grams;
}

function profile(language: string) {
  const cached = profileCache.get(language);

  if (cached) {
    return cached;
  }

  const grams = new Set<string>();

  for (const word of functionWords.get(language) ?? []) {
    for (const gram of trigramsOf(word)) {
      grams.add(gram);
    }
  }

  profileCache.set(language, grams);

  return grams;
}

export function detectLanguage(text: string) {
  const trimmed = text.trim();

  if (trimmed.length < 200) {
    return null;
  }

  const cyrillic = (trimmed.match(cyrillicPattern) ?? []).length;

  if (cyrillic / trimmed.length > 0.5) {
    return "ru";
  }

  const grams = trigramsOf(trimmed.slice(0, 500));
  let compared = { language: "en", coverage: gramCoverage(grams, "en") };

  for (const language of functionWords.keys()) {
    if (language === "en") {
      continue;
    }

    const coverage = gramCoverage(grams, language);

    if (coverage > compared.coverage + 0.02) {
      compared = { language, coverage };
    }
  }

  return compared.language;
}

function gramCoverage(grams: Set<string>, language: string) {
  if (grams.size === 0) {
    return 0;
  }

  const languageProfile = profile(language);
  const gramsInProfile = [...grams].filter((gram) => languageProfile.has(gram)).length;

  return gramsInProfile / grams.size;
}
