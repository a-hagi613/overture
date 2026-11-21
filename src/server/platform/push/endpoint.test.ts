import { describe, expect, test } from "bun:test";

import { isAllowedPushEndpoint } from "./endpoint.ts";

describe("isAllowedPushEndpoint", () => {
  test.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://db5p.notify.windows.com/?token=abc",
  ])("allows the push service %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint, "production")).toBe(true);
  });

  test.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://overture-web.internal/x",
    "https://[::1]/x",
    "not a url",
  ])("refuses %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint, "production")).toBe(false);
  });

  test("allows .test hosts outside production only", () => {
    expect(isAllowedPushEndpoint("https://push.example.test/send/x", "test")).toBe(true);
    expect(isAllowedPushEndpoint("https://push.example.test/send/x", "production")).toBe(false);
  });
});
