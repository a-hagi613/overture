import { expect, test } from "bun:test";

import { sanitiseFormHtml } from "./sanitise.ts";

test("script elements are removed including end tags with whitespace and attributes", () => {
  const html = sanitiseFormHtml(
    "<p>Before</p><script>alert(1)</script\t\n bar><p>After</p><script src=/a.js></script >",
  );

  expect(html).not.toContain("<script");
  expect(html).not.toContain("alert(1)");
  expect(html).toContain("<p>Before</p>");
  expect(html).toContain("<p>After</p>");
});

test("nested and malformed script markup cannot survive as an element or an event attribute", () => {
  const html = sanitiseFormHtml(
    '<form><scr<script>ipt>alert(1)</script><input onclick="steal()" onerror=bad name=x></form>',
  );

  expect(html).not.toContain("<script");
  expect(html).not.toContain("onclick");
  expect(html).not.toContain("onerror");
});

test("filled values, textareas, csrf fields and email addresses are stripped", () => {
  const html = sanitiseFormHtml(
    '<p>Write to maya.okafor@example.com</p><input name=email value="maya.okafor@example.com"><textarea name=note>Maya will call.</textarea><input type=hidden name=authenticity_token value=secret>',
  );

  expect(html).not.toContain("maya.okafor@example.com");
  expect(html).not.toContain("Maya will call.");
  expect(html).not.toContain("secret");
  expect(html).toContain("applicant@example.invalid");
  expect(html).toContain('value=""');
});

test("tracking parameters leave URLs and benign parameters stay", () => {
  const html = sanitiseFormHtml(
    '<a href="/jobs/1?utm_source=greenhouse&gclid=abc&page=2">Apply</a><form action="/apply?fbclid=1"></form>',
  );

  expect(html).not.toContain("utm_source");
  expect(html).not.toContain("gclid");
  expect(html).not.toContain("fbclid");
  expect(html).toContain("/jobs/1?page=2");
  expect(html).toContain('action="/apply"');
});
