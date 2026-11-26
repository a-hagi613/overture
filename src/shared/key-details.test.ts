import { describe, expect, test } from "bun:test";

import {
  KEY_DETAIL_FACT_KEYS,
  KEY_DETAIL_FACT_LABELS,
  KEY_DETAIL_ROWS,
  yesNoFromStatement,
} from "./key-details.ts";

describe("the key details one screen asks for", () => {
  test("lists every key once, in the required order", () => {
    const rowKeys = KEY_DETAIL_ROWS.flatMap((row) => row.keys);

    expect(rowKeys).toEqual([...KEY_DETAIL_FACT_KEYS]);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
  });

  test("names every key, so setup and saved answers read the same label", () => {
    expect(Object.keys(KEY_DETAIL_FACT_LABELS).toSorted()).toEqual(
      [...KEY_DETAIL_FACT_KEYS].toSorted(),
    );
  });

  test("keeps city and country in one row and LinkedIn optional", () => {
    const cityCountry = KEY_DETAIL_ROWS.find((row) => row.id === "city-country");
    const linkedin = KEY_DETAIL_ROWS.find((row) => row.id === "linkedin");

    expect(cityCountry?.keys).toEqual(["current_city", "current_country"]);
    expect(linkedin?.required).toBe(false);
  });
});

describe("reading a saved answer as a yes or no", () => {
  test("keeps a plain yes or no, whatever its case", () => {
    expect(yesNoFromStatement("Yes")).toBe("Yes");
    expect(yesNoFromStatement("no")).toBe("No");
  });

  test("reads a citizenship or permit statement as yes", () => {
    expect(yesNoFromStatement("Canadian citizen")).toBe("Yes");
    expect(yesNoFromStatement("EU work permit")).toBe("Yes");
  });

  test("reads a refusal or a sponsorship need as no", () => {
    expect(yesNoFromStatement("No")).toBe("No");
    expect(yesNoFromStatement("I need sponsorship")).toBe("No");
    expect(yesNoFromStatement("Not authorised to work in the US")).toBe("No");
  });

  test("shows nothing for an empty answer", () => {
    expect(yesNoFromStatement("")).toBe("");
    expect(yesNoFromStatement("   ")).toBe("");
  });
});
