import { describe, expect, test } from "bun:test";

import { isLiveTopic, TOPIC_QUERY_KEYS } from "./live-events.ts";

function keysOf(topic: keyof typeof TOPIC_QUERY_KEYS) {
  return TOPIC_QUERY_KEYS[topic].map((queryKey) => queryKey.join("."));
}

describe("the live topic map", () => {
  test("refreshes billing from its own topic and from the home alias", () => {
    expect(isLiveTopic("billing.updated")).toBe(true);
    expect(keysOf("billing.updated")).toEqual(["home", "nav", "ready", "billing"]);
    expect(keysOf("home.updated")).toContain("billing");
  });

  test("refreshes the mailbox from its own topic and from the message alias", () => {
    expect(isLiveTopic("mailbox.updated")).toBe(true);
    expect(keysOf("mailbox.updated")).toEqual(["home", "nav", "mailbox", "onboarding-mailbox"]);
    expect(keysOf("message.received")).toEqual([
      "home",
      "nav",
      "threads",
      "thread",
      "mailbox",
      "onboarding-mailbox",
    ]);
  });

  test("refreshes profile facts from its own topic and from the review alias", () => {
    expect(isLiveTopic("profile.updated")).toBe(true);
    expect(keysOf("profile.updated")).toEqual([
      "home",
      "nav",
      "profile-facts",
      "apply-email",
      "ready",
    ]);
    expect(keysOf("review.resolved")).toContain("profile-facts");
  });

  test("does not treat an unknown event name as a topic", () => {
    expect(isLiveTopic("billing.removed")).toBe(false);
    expect(isLiveTopic("")).toBe(false);
  });
});
