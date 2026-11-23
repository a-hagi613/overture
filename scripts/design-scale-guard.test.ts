import { expect, test } from "bun:test";

import { findOffScaleDesignToken } from "./design-scale-guard.ts";

test("every arbitrary font-size utility is off the nine typography tokens", () => {
  for (const token of [
    "text-[13px]",
    "text-[12.5px]",
    "text-[10.5px]",
    "text-[1rem]",
    "text-[0.875rem]",
    "text-lg",
    "text-xl",
    "text-2xl",
    "text-9xl",
  ]) {
    expect(findOffScaleDesignToken(`flex ${token} font-serif`)).toBe(token);
  }
});

test("arbitrary spacing utilities are off the 4px scale", () => {
  for (const token of ["p-[13px]", "gap-[7px]", "mt-[2rem]", "px-[26px]"]) {
    expect(findOffScaleDesignToken(`flex ${token}`)).toBe(token);
  }
});

test("the tokens, the scale and layout widths are allowed", () => {
  for (const className of [
    "text-hero",
    "text-section",
    "text-page-title",
    "text-card-title",
    "text-metric",
    "text-eyebrow",
    "text-base",
    "text-sm",
    "text-xs",
    "p-4",
    "gap-3",
    "mt-0.5",
    "rounded-[16px]",
    "max-w-[1200px]",
  ]) {
    expect(findOffScaleDesignToken(className)).toBeNull();
  }
});
