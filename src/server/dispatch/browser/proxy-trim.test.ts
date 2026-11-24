import { describe, expect, test } from "bun:test";

import { CAPTCHA_HOSTS, TRACKER_HOSTS, shouldTrimRequest } from "./proxy-trim.ts";

describe("the send proxy trim", () => {
  test("a generic image is aborted before it crosses the paid proxy", () => {
    expect(shouldTrimRequest("https://boards.example.com/logo.png", "image")).toBe(true);
    expect(shouldTrimRequest("https://cdn.example.com/photos/team.webp", "image")).toBe(true);
    expect(shouldTrimRequest("https://www.doubleclick.net/ad.png", "image")).toBe(true);
  });

  test("a CAPTCHA image still loads from every solver host", () => {
    for (const host of CAPTCHA_HOSTS) {
      expect(shouldTrimRequest(`https://${host}/challenge.png`, "image")).toBe(false);
    }
  });

  test("fonts, media and tracker hosts stay blocked while scripts, XHR and documents load", () => {
    expect(shouldTrimRequest("https://boards.example.com/font.woff2", "font")).toBe(true);
    expect(shouldTrimRequest("https://boards.example.com/demo.mp4", "media")).toBe(true);

    for (const host of TRACKER_HOSTS) {
      expect(shouldTrimRequest(`https://${host}/collect`, "script")).toBe(true);
    }

    expect(shouldTrimRequest("https://boards.example.com/app.js", "script")).toBe(false);
    expect(shouldTrimRequest("https://boards.example.com/api/form", "xhr")).toBe(false);
    expect(shouldTrimRequest("https://boards.example.com/jobs/1", "document")).toBe(false);
  });

  test("an unparseable URL is left for the browser to reject", () => {
    expect(shouldTrimRequest("not a url", "image")).toBe(false);
  });
});
