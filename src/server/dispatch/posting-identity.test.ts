import { expect, test } from "bun:test";

import { canonicalBoardToken, checkPostingIdentity } from "./posting-identity.ts";

const pageAt = (url: string) => ({
  async title() {
    await Promise.resolve();

    return "Art Teacher - Al Danah | International Community Schools";
  },
  url: () => url,
});

const zoho = {
  ats: "zoho_recruit" as const,
  boardToken: "icschools.zohorecruit.com",
  companyName: "International Community Schools",
  jobId: "769705000015883276",
  url: "https://icschools.zohorecruit.com/jobs/Careers/769705000015883276?utm_source=freehire.me",
};

test("a Zoho careers host and its subdomain are the same board token", () => {
  expect(canonicalBoardToken("zoho_recruit", "icschools.zohorecruit.com")).toBe("icschools");
  expect(canonicalBoardToken("zoho_recruit", "icschools")).toBe("icschools");
  expect(canonicalBoardToken("zoho_recruit", "greatertorontomusic.zohorecruit.ca")).toBe(
    "greatertorontomusic",
  );
});

test("a Zoho Recruit posting accepts freehire's whole-host board token", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://icschools.zohorecruit.com/jobs/Careers/769705000015883276"),
      zoho,
    ),
  ).toEqual({ ok: true });
});

test("a Zoho Recruit regional posting compares its own subdomain", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://greatertorontomusic.zohorecruit.ca/jobs/Careers/3566000001383119"),
      {
        ats: "zoho_recruit",
        boardToken: "greatertorontomusic.zohorecruit.ca",
        companyName: "Greater Toronto Music School",
        jobId: "3566000001383119",
        url: "https://greatertorontomusic.zohorecruit.ca/jobs/Careers/3566000001383119",
      },
    ),
  ).toEqual({ ok: true });
});

test("a Zoho Recruit posting for another job still stops the send", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://icschools.zohorecruit.com/jobs/Careers/769705000015883277"),
      zoho,
    ),
  ).toEqual({ ok: false, reason: "job_id" });
});

test("a Zoho Recruit posting on another employer is a host mismatch", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://other.zohorecruit.com/jobs/Careers/769705000015883276"),
      zoho,
    ),
  ).toEqual({ ok: false, reason: "host" });
});

test("a BambooHR whole-host board token still resolves to its subdomain", async () => {
  expect(
    await checkPostingIdentity(pageAt("https://kidsu.bamboohr.com/careers/1591"), {
      ats: "bamboohr",
      boardToken: "kidsu.bamboohr.com",
      companyName: "Kids U",
      jobId: "1591",
      url: "https://kidsu.bamboohr.com/careers/1591",
    }),
  ).toEqual({ ok: true });

  expect(
    await checkPostingIdentity(pageAt("https://other.bamboohr.com/careers/1591"), {
      ats: "bamboohr",
      boardToken: "kidsu.bamboohr.com",
      companyName: "Kids U",
      jobId: "1591",
      url: "https://kidsu.bamboohr.com/careers/1591",
    }),
  ).toEqual({ ok: false, reason: "host" });
});
