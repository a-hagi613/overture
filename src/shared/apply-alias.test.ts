import { describe, expect, test } from "bun:test";

import {
  aliasHandleBase,
  aliasHandleCandidate,
  applyAliasAddress,
  applyEmailInputSchema,
  isReservedAliasHandle,
  normalizeAliasWords,
  planEmailAddress,
  RESERVED_ALIAS_LOCAL_PARTS,
} from "./apply-alias.ts";

describe("a readable apply handle", () => {
  test("is the first and last name in lowercase, with accents folded", () => {
    expect(aliasHandleBase("Alex Chen", "alex@example.com")).toBe("alex.chen");
    expect(aliasHandleBase("Alex Michael Chen", "alex@example.com")).toBe("alex.chen");
    expect(aliasHandleBase("Élodie Müller", "elodie@example.com")).toBe("elodie.muller");
    expect(aliasHandleBase("  Maya   Okafor  ", "maya@example.com")).toBe("maya.okafor");
  });

  test("falls back to the sign-in email's local part when the name has no usable words", () => {
    expect(aliasHandleBase("", "maya.okafor+job@example.com")).toBe("maya.okafor");
    expect(aliasHandleBase("!!!", "first-last@example.com")).toBe("first.last");
  });

  test("falls back to a neutral handle when neither the name nor the email helps", () => {
    expect(aliasHandleBase("", "x@example.com")).toBe("x");
    expect(aliasHandleBase("", "@example.com")).toBe("person");
  });

  test("never uses a system local part as the readable base", () => {
    const singleWords = RESERVED_ALIAS_LOCAL_PARTS.filter((reserved) => !reserved.includes("-"));

    for (const reserved of singleWords) {
      expect(aliasHandleBase(reserved.toUpperCase(), `${reserved}@example.com`)).toBe("person");
    }

    expect(aliasHandleBase("Support", "alex@example.com")).toBe("alex");
    expect(aliasHandleBase("Support Smith", "help.desk@example.com")).toBe("person");
    expect(aliasHandleBase("Support Smith", "alex@example.com")).toBe("alex");
  });

  test("normalises only to lowercase ASCII words joined by single dots", () => {
    expect(normalizeAliasWords("  Alex...Chen  ")).toBe("alex.chen");
    expect(normalizeAliasWords("Zoë O'Brien-Smith")).toBe("zoe.o.brien.smith");
    expect(normalizeAliasWords("   ")).toBe("");
  });
});

describe("a reserved system prefix", () => {
  test("is refused as a whole local part and as the first dot-label", () => {
    expect(isReservedAliasHandle("support")).toBe(true);
    expect(isReservedAliasHandle("support.abc")).toBe(true);
    expect(isReservedAliasHandle("mailer-daemon.abc")).toBe(true);
    expect(isReservedAliasHandle("alex.chen")).toBe(false);
    expect(isReservedAliasHandle("supporter")).toBe(false);
  });

  test("is skipped by the first candidate so a reserved name starts with a suffix", () => {
    expect(aliasHandleCandidate("support", 0, "abc")).toBe("support.abc");
    expect(aliasHandleCandidate("alex.chen", 0, "abc")).toBe("alex.chen");
    expect(aliasHandleCandidate("alex.chen", 1, "abc")).toBe("alex.chen.abc");
  });
});

describe("an apply address", () => {
  test("joins the handle to the configured domain in lowercase", () => {
    expect(applyAliasAddress("Alex.Chen.4k", "TryOverture.com")).toBe(
      "alex.chen.4k@tryoverture.com",
    );
  });

  test("accepts only a boolean preference", () => {
    expect(applyEmailInputSchema.parse({ usePersonalEmail: true })).toEqual({
      usePersonalEmail: true,
    });
    expect(applyEmailInputSchema.safeParse({ usePersonalEmail: "yes" }).success).toBe(false);
  });
});

describe("the address on a new application", () => {
  test("is the alias unless the person chose their sign-in email", () => {
    const alias = "alex.chen@tryoverture.com";
    const personal = "alex@example.com";

    expect(planEmailAddress(false, alias, personal)).toBe(alias);
    expect(planEmailAddress(true, alias, personal)).toBe(personal);
    expect(planEmailAddress(false, null, personal)).toBe(personal);
    expect(planEmailAddress(true, null, personal)).toBe(personal);
  });
});
