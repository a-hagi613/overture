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

const flexstaf = {
  ats: "manatal" as const,
  boardToken: "flexstaf-it-plan",
  companyName: "Flexstaf IT",
  jobId: "W3994VR9",
  url: "https://www.careers-page.com/flexstaf-it/job/W3994VR9",
};

test("a Freehire Manatal posting is grounded on the careers-page URL", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply"),
      flexstaf,
    ),
  ).toEqual({ ok: true });
});

test("a Manatal posting on another careers-page board is a board mismatch", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://www.careers-page.com/otherco/job/W3994VR9/apply"),
      flexstaf,
    ),
  ).toEqual({ ok: false, reason: "board_token" });
});

test("a Manatal posting for another job still stops the send", async () => {
  expect(
    await checkPostingIdentity(
      pageAt("https://www.careers-page.com/flexstaf-it/job/OTHER123/apply"),
      flexstaf,
    ),
  ).toEqual({ ok: false, reason: "job_id" });
});

test("a Manatal board on its own subdomain still matches the hosted board", async () => {
  expect(
    await checkPostingIdentity(pageAt("https://flexstaf-it.manatal.com/jobs/W3994VR9"), {
      ...flexstaf,
      boardToken: "flexstaf-it",
      url: "https://flexstaf-it.manatal.com/jobs/W3994VR9",
    }),
  ).toEqual({ ok: true });
});
