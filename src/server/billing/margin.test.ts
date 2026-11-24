import { expect, test } from "bun:test";

import {
  netRevenueMicrosPerApplication,
  STRIPE_DOMESTIC_FEE_RATE,
  STRIPE_INTERNATIONAL_FEE_RATE,
  stripeFeeMicros,
} from "./stripe-fees.ts";

const WEEK_PRICE_MICROS = 9_990_000;
const MONTH_PRICE_MICROS = 29_990_000;
const WEEK_APPLICATIONS = 50;
const MONTH_APPLICATIONS = 250;

test("regular Stripe Billing charges 3.6 % + $0.30 domestic and 5.1 % + $0.30 international", () => {
  expect(STRIPE_DOMESTIC_FEE_RATE).toBeCloseTo(0.036, 10);
  expect(STRIPE_INTERNATIONAL_FEE_RATE).toBeCloseTo(0.051, 10);

  expect(stripeFeeMicros(WEEK_PRICE_MICROS, STRIPE_DOMESTIC_FEE_RATE)).toBe(660_000);
  expect(stripeFeeMicros(MONTH_PRICE_MICROS, STRIPE_DOMESTIC_FEE_RATE)).toBe(1_380_000);
  expect(stripeFeeMicros(WEEK_PRICE_MICROS, STRIPE_INTERNATIONAL_FEE_RATE)).toBe(810_000);
  expect(stripeFeeMicros(MONTH_PRICE_MICROS, STRIPE_INTERNATIONAL_FEE_RATE)).toBe(1_830_000);
});

test("a free price carries no Stripe fee", () => {
  expect(stripeFeeMicros(0, STRIPE_DOMESTIC_FEE_RATE)).toBe(0);
});

test("net revenue baselines are $0.187 an Application on Week and $0.114 on Month", () => {
  expect(netRevenueMicrosPerApplication(WEEK_PRICE_MICROS, WEEK_APPLICATIONS)).toBe(186_600);
  expect(netRevenueMicrosPerApplication(MONTH_PRICE_MICROS, MONTH_APPLICATIONS)).toBe(114_440);
});

test("the international baselines are $0.184 on Week and $0.113 on Month", () => {
  expect(
    netRevenueMicrosPerApplication(
      WEEK_PRICE_MICROS,
      WEEK_APPLICATIONS,
      STRIPE_INTERNATIONAL_FEE_RATE,
    ),
  ).toBe(183_600);
  expect(
    netRevenueMicrosPerApplication(
      MONTH_PRICE_MICROS,
      MONTH_APPLICATIONS,
      STRIPE_INTERNATIONAL_FEE_RATE,
    ),
  ).toBe(112_640);
});
