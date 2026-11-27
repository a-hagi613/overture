import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

import { promotePlaceValues, resolvePlaceText } from "./resolve.ts";

const fixtureSchema = z.array(
  z.object({
    expect: z.array(z.string()),
    input: z.string(),
  }),
);

const cases = fixtureSchema.parse(
  JSON.parse(readFileSync("src/server/places/fixtures/location-strings.json", "utf8")),
);

function sorted(values: readonly string[]) {
  return [...new Set(values)].toSorted();
}

describe("the hand-checked location strings", () => {
  test("at least 300 strings, and every one resolves exactly", () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);

    const failures = cases.flatMap((row) => {
      const got = sorted(resolvePlaceText(row.input).ids);
      const expected = sorted(row.expect);

      return JSON.stringify(got) === JSON.stringify(expected)
        ? []
        : [{ expected, got, input: row.input }];
    });

    const accuracy = (cases.length - failures.length) / cases.length;

    expect(failures).toEqual([]);
    expect(accuracy).toBeGreaterThanOrEqual(0.98);
  });

  test("Frisco, Texas is Frisco, never San Francisco", () => {
    const { ids } = resolvePlaceText("Frisco, Texas");

    expect(ids).toEqual(["city:us:frisco"]);
    expect(ids).not.toContain("city:us:san-francisco");
  });

  test("a remote string that names the US never matches a remote Canada user", () => {
    const job = resolvePlaceText("Remote US only").ids;
    const user = resolvePlaceText("Remote Canada").ids;

    expect(job).toContain("remote:country:us");
    expect(job).not.toContain("remote:country:ca");
    expect(user).toContain("remote:country:ca");
    expect(user).not.toContain("remote:country:us");
  });

  test("a name shared across countries is left for the person to pick", () => {
    expect(resolvePlaceText("Victoria")).toEqual({ ids: [], unresolved: ["Victoria"] });
    expect(resolvePlaceText("Victoria, British Columbia").ids).toEqual(["city:ca:victoria"]);
  });

  test("a canonical id is kept as is", () => {
    expect(resolvePlaceText("remote:continent:EU")).toEqual({
      ids: ["remote:continent:EU"],
      unresolved: [],
    });
    expect(resolvePlaceText("city:ca:toronto")).toEqual({
      ids: ["city:ca:toronto"],
      unresolved: [],
    });
  });
});

describe("promoting stored values", () => {
  test("resolves raw values once and is idempotent", () => {
    const once = promotePlaceValues(["Toronto, Canada", "Victoria", "city:de:berlin", "Narnia"]);

    expect(once).toEqual({
      ids: ["city:ca:toronto", "city:de:berlin"],
      unresolved: ["Narnia", "Victoria"],
    });
    expect(promotePlaceValues([...once.ids, ...once.unresolved])).toEqual({
      ids: ["city:ca:toronto", "city:de:berlin"],
      unresolved: ["Narnia", "Victoria"],
    });
  });
});
