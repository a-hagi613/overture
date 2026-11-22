interface BatchPricesMicros {
  inputPerMillionTokens: number;
  cacheReadPerMillionTokens: number;
  cacheWritePerMillionTokens: number;
  outputPerMillionTokens: number;
}

interface BatchPriceRow {
  prefix: string;
  prices: BatchPricesMicros;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

const BATCH_PRICES_MICROS: readonly BatchPriceRow[] = [
  {
    prefix: "claude-haiku",
    prices: {
      inputPerMillionTokens: 500_000,
      cacheReadPerMillionTokens: 50_000,
      cacheWritePerMillionTokens: 625_000,
      outputPerMillionTokens: 2_500_000,
    },
  },
  {
    prefix: "claude-haiku-5-5",
    prices: {
      inputPerMillionTokens: 50_000,
      cacheReadPerMillionTokens: 5000,
      cacheWritePerMillionTokens: 62_500,
      outputPerMillionTokens: 250_000,
    },
  },
  {
    prefix: "claude-sonnet",
    prices: {
      inputPerMillionTokens: 1_500_000,
      cacheReadPerMillionTokens: 150_000,
      cacheWritePerMillionTokens: 1_875_000,
      outputPerMillionTokens: 7_500_000,
    },
  },
  {
    prefix: "claude-opus",
    prices: {
      inputPerMillionTokens: 2_500_000,
      cacheReadPerMillionTokens: 250_000,
      cacheWritePerMillionTokens: 3_125_000,
      outputPerMillionTokens: 12_500_000,
    },
  },
];

export function batchPricesFor(model: string) {
  let matched: BatchPriceRow | undefined;

  for (const candidate of BATCH_PRICES_MICROS) {
    if (
      model.startsWith(candidate.prefix) &&
      (matched === undefined || candidate.prefix.length > matched.prefix.length)
    ) {
      matched = candidate;
    }
  }

  if (matched === undefined) {
    throw new Error(`no batch pricing is known for model ${model}`);
  }

  return matched.prices;
}
