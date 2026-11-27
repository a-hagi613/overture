import { describe, expect, test } from "bun:test";

import { isPrivateAddressLiteral, postingUrlProblem } from "./posting-url.ts";

describe("postingUrlProblem", () => {
  test("opens a real ATS posting over https", () => {
    expect(postingUrlProblem("https://jobs.lever.co/acme/1234/apply")).toBeNull();
    expect(postingUrlProblem("https://boards.greenhouse.io/acme/jobs/42")).toBeNull();
  });

  test("keeps the local fixture hosts over plain http only when the caller allows fixtures", () => {
    const fixtures = { allowFixtureHttp: true };

    expect(postingUrlProblem("http://127.0.0.1:4173/lever/acme/42/apply", fixtures)).toBeNull();
    expect(postingUrlProblem("http://localhost:3000/workable/acme/j/42", fixtures)).toBeNull();

    expect(postingUrlProblem("http://127.0.0.1:4173/lever/acme/42/apply")).toBe("insecure");
    expect(postingUrlProblem("http://localhost:3000/workable/acme/j/42")).toBe("insecure");
  });

  test("refuses a plain-http posting that is not a local fixture", () => {
    expect(postingUrlProblem("http://jobs.lever.co/acme/1234/apply")).toBe("insecure");
    expect(postingUrlProblem("http://169.254.169.254/latest/meta-data/")).toBe("insecure");
  });

  test("refuses a scheme a browser would run code from or read a local file with", () => {
    expect(postingUrlProblem(`${["java", "script"].join("")}:alert(document.cookie)`)).toBe(
      "insecure",
    );
    expect(postingUrlProblem("data:text/html,<form>")).toBe("insecure");
    expect(postingUrlProblem("file:///etc/passwd")).toBe("insecure");
  });

  test("refuses embedded credentials, which would travel to the employer's server", () => {
    expect(postingUrlProblem("https://person:secret@jobs.lever.co/acme/1234/apply")).toBe(
      "insecure",
    );
  });

  test("refuses a private or loopback address literal on an otherwise safe scheme", () => {
    expect(postingUrlProblem("https://10.0.0.7/apply")).toBe("insecure");
    expect(postingUrlProblem("https://192.168.1.20/apply")).toBe("insecure");
    expect(postingUrlProblem("https://127.0.0.1/apply")).toBe("insecure");
    expect(postingUrlProblem("https://[::1]/apply")).toBe("insecure");
    expect(postingUrlProblem("https://[fd00::1]/apply")).toBe("insecure");
    expect(postingUrlProblem("https://[::ffff:127.0.0.1]/apply")).toBe("insecure");
  });

  test("refuses a loopback or metadata name even on https", () => {
    expect(postingUrlProblem("https://localhost/apply")).toBe("insecure");
    expect(postingUrlProblem("https://app.localhost/apply")).toBe("insecure");
    expect(postingUrlProblem("https://printer.local/apply")).toBe("insecure");
    expect(postingUrlProblem("https://metadata.google.internal/apply")).toBe("insecure");
  });

  test("accepts a public https address that is not a private literal", () => {
    expect(postingUrlProblem("https://203.0.113.10/apply")).toBeNull();
  });

  test("an unparsable stored URL is never opened", () => {
    expect(postingUrlProblem("")).toBe("unreadable");
    expect(postingUrlProblem("not a url")).toBe("unreadable");
  });
});

describe("isPrivateAddressLiteral", () => {
  test("covers loopback, private, link-local, CGNAT and reserved IPv4 ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "198.18.0.1",
      "224.0.0.1",
    ]) {
      expect(isPrivateAddressLiteral(address), address).toBe(true);
    }
  });

  test("leaves public IPv4 and ordinary hostnames alone", () => {
    expect(isPrivateAddressLiteral("203.0.113.10")).toBe(false);
    expect(isPrivateAddressLiteral("172.32.0.1")).toBe(false);
    expect(isPrivateAddressLiteral("jobs.lever.co")).toBe(false);
  });

  test("covers IPv6 loopback, link-local, unique-local and mapped private addresses", () => {
    for (const address of [
      "[::1]",
      "[fe80::1]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[::ffff:10.0.0.1]",
    ]) {
      expect(isPrivateAddressLiteral(address), address).toBe(true);
    }

    expect(isPrivateAddressLiteral("[2606:4700::1111]")).toBe(false);
  });
});
