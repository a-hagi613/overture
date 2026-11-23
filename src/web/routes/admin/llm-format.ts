import { copy } from "../../../shared/copy.ts";

export function formatUsdMicros(micros: number) {
  const dollars = micros / 1_000_000;

  if (dollars >= 1) {
    return `$${dollars.toFixed(2)}`;
  }

  return `$${dollars.toFixed(4)}`;
}

export function formatTokenCount(tokens: number) {
  return tokens.toLocaleString("en-US");
}

export function cacheHitRateOf(cachedTokens: number, inputTokens: number) {
  if (inputTokens <= 0) {
    return null;
  }

  return cachedTokens / inputTokens;
}

export function formatCacheHitRate(cachedTokens: number, inputTokens: number) {
  const rate = cacheHitRateOf(cachedTokens, inputTokens);

  return rate === null ? copy.admin.reportNone : copy.admin.reportRate(rate);
}

export function capRatioOf(spentMicros: number, capMicros: number | null) {
  if (capMicros === null || capMicros <= 0) {
    return null;
  }

  return {
    over: spentMicros > capMicros,
    percent: Math.min(100, Math.max(0, (spentMicros / capMicros) * 100)),
  };
}

export function isUnexpectedModel(model: string, expectedModel: string) {
  return !(model === expectedModel || model.startsWith(`${expectedModel}-`));
}
