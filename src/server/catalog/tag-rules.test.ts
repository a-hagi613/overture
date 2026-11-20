import { describe, expect, test } from "bun:test";

import {
  classifyTitle,
  stripSeniorityTokens,
  tagPosting,
  titleSimilarityThreshold,
} from "./tag-rules.ts";
import { detectLanguage } from "./language.ts";
import { isRemoteLocationText, resolveLocation } from "./geo.ts";
import { parsePayRange } from "./salary.ts";

import type { PostingTagInput } from "../../shared/tag-taxonomy.ts";

function postingOf(fields: PostingTagInput) {
  return tagPosting({
    department: null,
    descriptionText: null,
    employmentType: null,
    isRemote: null,
    language: null,
    locationRaw: null,
    salary: null,
    workplaceType: null,
    ...fields,
  });
}

describe("workplace", () => {
  test("source workplaceType field wins", () => {
    const tags = postingOf({ title: "Software Engineer", workplaceType: "Hybrid" });

    expect(tags.workplace).toBe("hybrid");
  });

  test("onsite and on-site spellings both mean onsite", () => {
    for (const workplaceType of ["OnSite", "onsite", "on-site", "On-Site"]) {
      const tags = postingOf({ title: "Software Engineer", workplaceType });

      expect(tags.workplace).toBe("onsite");
    }
  });

  test("isRemote flag", () => {
    const tags = postingOf({ title: "Software Engineer", isRemote: true });

    expect(tags.workplace).toBe("remote");
  });

  test("hybrid token in location text", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "Hybrid - Warsaw, Poland" });

    expect(tags.workplace).toBe("hybrid");
  });

  test("remote token in location text", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "Remote" });

    expect(tags.workplace).toBe("remote");
    expect(tags.city).toBeNull();
  });

  test("no signal stays unknown", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "New York, NY" });

    expect(tags.workplace).toBe("unknown");
  });

  test("hybrid working phrase in the description", () => {
    const tags = postingOf({
      title: "Account Executive",
      locationRaw: "London",
      descriptionText: "This is a full time hybrid role based in our London hub.",
    });

    expect(tags.workplace).toBe("hybrid");
  });

  test("fully remote phrase in the description", () => {
    const tags = postingOf({
      title: "Support Engineer",
      locationRaw: "United States",
      descriptionText:
        "An overview of this role This position is 100% remote and will be based in the US.",
    });

    expect(tags.workplace).toBe("remote");
    expect(tags.city).toBeNull();
  });
});

describe("employment type", () => {
  test("source enum value normalises", () => {
    const tags = postingOf({ title: "Software Engineer", employmentType: "Full-time" });

    expect(tags.employmentType).toBe("full_time");
  });

  test("internship keyword in the description head", () => {
    const tags = postingOf({
      title: "Software Development program",
      descriptionText:
        "This is a 12-week internship for students in their final year. Full-time work follows.",
    });

    expect(tags.employmentType).toBe("internship");
  });

  test("contract keyword in the title", () => {
    const tags = postingOf({ title: "Contract Software Engineer" });

    expect(tags.employmentType).toBe("contract");
  });

  test("no signal stays unknown", () => {
    const tags = postingOf({ title: "Software Engineer" });

    expect(tags.employmentType).toBe("unknown");
  });
});

describe("location", () => {
  test("city, region abbreviation and country", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "San Francisco, CA, USA" });

    expect(tags.countryCode).toBe("US");
    expect(tags.region).toBe("California");
    expect(tags.city).toBe("San Francisco");
  });

  test("city and country by name", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "Warsaw, Poland" });

    expect(tags.countryCode).toBe("PL");
    expect(tags.city).toBe("Warsaw");
  });

  test("diacritics fold", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "São Paulo, Brazil" });

    expect(tags.countryCode).toBe("BR");
    expect(tags.city).toBe("Sao Paulo");
  });

  test("resolveLocation maps a city to country and region", () => {
    const location = resolveLocation("Warsaw, Poland");

    expect(location.countryCode).toBe("PL");
    expect(location.city).toBe("Warsaw");
    expect(location.region).not.toBeNull();
  });

  test("remote posting keeps the country and drops city", () => {
    const tags = postingOf({
      title: "Software Engineer",
      locationRaw: "Remote - Germany",
      isRemote: null,
    });

    expect(tags.countryCode).toBe("DE");
    expect(tags.city).toBeNull();
    expect(tags.region).toBeNull();
  });

  test("unresolvable location", () => {
    const tags = postingOf({ title: "Software Engineer", locationRaw: "EMEA Growth Team" });

    expect(tags.countryCode).toBeNull();
    expect(tags.city).toBeNull();
  });
});

describe("language", () => {
  test("the source field wins", () => {
    const tags = postingOf({ title: "Software Engineer", language: "de" });

    expect(tags.language).toBe("de");
  });

  test("german text is detected", () => {
    const tags = postingOf({
      title: "Software Entwickler",
      descriptionText:
        "Wir suchen einen Entwickler für unser Team in Berlin. Du arbeitest mit unserem Team an verteilten Systemen und weißt, wie man Software entwickelt und skalieren kann. Mit uns entwickelst du neue Features für mehrere Millionen von Kunden in ganz Europa und darüber hinaus sehr gerne gemeinsam.",
    });

    expect(tags.language).toBe("de");
  });

  test("short English text defaults to english", () => {
    const tags = postingOf({ title: "Software Engineer" });

    expect(tags.language).toBe("en");
  });
});

describe("salary", () => {
  test("structured fields pass through", () => {
    const tags = postingOf({
      title: "Software Engineer",
      salary: { currency: "CAD", minMinor: 12_000_000, maxMinor: 15_000_000, period: "year" },
    });

    expect(tags.salaryCurrency).toBe("CAD");
    expect(tags.salaryMinMinor).toBe(12_000_000);
    expect(tags.salaryMaxMinor).toBe(15_000_000);
    expect(tags.salaryPeriod).toBe("year");
  });

  test("dollar range with commas in the description", () => {
    const range = parsePayRange(
      "The base salary range for this role is $120,000 – $150,000 per year.",
    );

    expect(range?.currency).toBe("USD");
    expect(range?.minMinor).toBe(12_000_000);
    expect(range?.maxMinor).toBe(15_000_000);
    expect(range?.period).toBe("year");
  });

  test("k shorthand range without a symbol", () => {
    const tags = postingOf({
      title: "Software Engineer",
      descriptionText: "Pay: 120k-150k depending on level",
    });

    expect(tags.salaryMinMinor).toBe(12_000_000);
    expect(tags.salaryMaxMinor).toBe(15_000_000);
  });

  test("european thousands", () => {
    const tags = postingOf({
      title: "Software Engineer",
      descriptionText: "Gehalt: €50.000 pro Jahr",
    });

    expect(tags.salaryCurrency).toBe("EUR");
    expect(tags.salaryMinMinor).toBe(5_000_000);
  });

  test("hourly range", () => {
    const range = parsePayRange("This position pays $50 - $70 an hour.");

    expect(range?.minMinor).toBe(5000);
    expect(range?.maxMinor).toBe(7000);
    expect(range?.period).toBe("hour");
  });

  test("a declared symbol-prefixed single figure", () => {
    const range = parsePayRange("Salary: £45,000 a year");

    expect(range?.currency).toBe("GBP");
    expect(range?.minMinor).toBe(4_500_000);
    expect(range?.period).toBe("year");
  });

  test("pay text without a range is not invented", () => {
    const range = parsePayRange("Our team of 10,000 people serves millions of merchants.");

    expect(range).toBeNull();
  });

  test("structured fields beat the description", () => {
    const tags = postingOf({
      title: "Software Engineer",
      salary: { currency: "USD", minMinor: 10_000_000, maxMinor: 12_000_000, period: "year" },
      descriptionText: "Pay: $200,000 - $300,000",
    });

    expect(tags.salaryMinMinor).toBe(10_000_000);
  });
});

describe("role, subrole and seniority rules", () => {
  test("software engineering with subrole and seniority", () => {
    const classified = classifyTitle("Senior Frontend Engineer", null);

    expect(classified.role).toBe("Software Engineering");
    expect(classified.subrole).toBe("Frontend");
    expect(classified.seniority).toBe("senior");
    expect(classified.roleSource).toBe("rules");
  });

  test("department text participates", () => {
    const classified = classifyTitle("Analyst", "Data Engineering");

    expect(classified.role).toBe("Data & Analytics");
  });

  test("security beats software engineering on the same title", () => {
    const classified = classifyTitle("Application Security Engineer", null);

    expect(classified.role).toBe("Security");
  });

  test("backend, mobile, platform, embedded and full-stack subroles", () => {
    expect(classifyTitle("Backend Engineer - Java", null).subrole).toBe("Backend");
    expect(classifyTitle("iOS Engineer", null).subrole).toBe("Mobile");
    expect(classifyTitle("Platform Engineer", null).subrole).toBe("Platform");
    expect(classifyTitle("Firmware Engineer", null).subrole).toBe("Embedded");
    expect(classifyTitle("Full Stack Developer", null).subrole).toBe("Full-stack");
  });

  test("seniority ladder", () => {
    expect(classifyTitle("Data Engineering Intern", null).seniority).toBe("intern");
    expect(classifyTitle("Junior Analyst", null).seniority).toBe("entry");
    expect(classifyTitle("Software Engineer II", null).seniority).toBe("mid");
    expect(classifyTitle("Software Engineer III", null).seniority).toBe("senior");
    expect(classifyTitle("Staff Software Engineer", null).seniority).toBe("staff");
    expect(classifyTitle("Principal Engineer", null).seniority).toBe("principal");
    expect(classifyTitle("Engineering Manager", null).seniority).toBe("manager");
    expect(classifyTitle("Head of Design", null).seniority).toBe("director");
    expect(classifyTitle("VP Engineering", null).seniority).toBe("director");
  });

  test("a level token on a manager title is kept", () => {
    expect(classifyTitle("Senior Event Marketing Manager", "Marketing").seniority).toBe("senior");
    expect(classifyTitle("Lead Program Manager", null).seniority).toBe("staff");
    expect(classifyTitle("Product Manager", null).seniority).toBeNull();
  });

  test("a manager title outside engineering is not a manager seniority", () => {
    const product = classifyTitle("Product Manager", null);
    const success = classifyTitle("Customer Success Manager", null);

    expect(product.role).toBe("Product Management");
    expect(product.seniority).toBeNull();
    expect(success.role).toBe("Customer Success");
    expect(success.seniority).toBeNull();
  });

  test("roles across other groups", () => {
    expect(classifyTitle("Registered Nurse", null).role).toBe("Healthcare");
    expect(classifyTitle("Account Executive", null).role).toBe("Sales");
    expect(classifyTitle("Copywriter", null).role).toBe("Communications & PR");
    expect(classifyTitle("DevOps Engineer", null).role).toBe("DevOps & Infrastructure");
    expect(classifyTitle("SDET", null).role).toBe("QA & Test");
    expect(classifyTitle("Payroll Specialist", null).role).toBe("Accounting");
    expect(classifyTitle("Technical Sourcer", null).role).toBe("Recruiting");
  });
});

describe("title similarity fallback", () => {
  test("a title the rules leave out is matched against O*NET titles", () => {
    const classified = classifyTitle("Solutions Architect", null);

    expect(classified.role).toBe("DevOps & Infrastructure");
    expect(classified.seniority).toBe("principal");
    expect(classified.roleSource).toBe("model");
  });

  test("seniority tokens are stripped before comparing", () => {
    expect(stripSeniorityTokens("Senior Data Modelling Consultant")).toBe(
      "data modelling consultant",
    );
  });

  test("an unknown title without a near O*NET match stays unclassified", () => {
    const classified = classifyTitle("Community Happiness Wizard", null);

    expect(classified.role).toBeNull();
    expect(classified.roleSource).toBe("unclassified");
  });

  test("the threshold rejects weak matches", () => {
    expect(titleSimilarityThreshold).toBeGreaterThan(0.5);
    expect(titleSimilarityThreshold).toBeLessThan(1);
  });
});

describe("precedence in tagPosting", () => {
  test("remote postings keep their country tag", () => {
    const tags = postingOf({ title: "Backend Engineer", locationRaw: "Remote - Canada" });

    expect(tags.workplace).toBe("remote");
    expect(tags.countryCode).toBe("CA");
    expect(tags.role).toBe("Software Engineering");
    expect(tags.subrole).toBe("Backend");
  });

  test("a missing description salary block and workplace leave unknown", () => {
    const tags = postingOf({ title: "Software Engineer" });

    expect(tags.salaryMinMinor).toBeNull();
    expect(tags.salaryCurrency).toBeNull();
    expect(tags.workplace).toBe("unknown");
  });
});

describe("remote location text helper", () => {
  test("remote and wfh tokens count, city names do not", () => {
    expect(isRemoteLocationText("Remote")).toBe(true);
    expect(isRemoteLocationText("Work from home (Berlin)")).toBe(true);
    expect(isRemoteLocationText("Berlin, Germany")).toBe(false);
    expect(isRemoteLocationText(null)).toBe(false);
  });
});

describe("language detector", () => {
  test("french text", () => {
    const detected = detectLanguage(
      "Airbnb est une plateforme communautaire qui met en relation des voyageurs et des hôtes. Nous recherchons un gestionnaire pour soutenir notre équipe premium et répondre aux besoins des membres dans le monde entier avec votre expertise de leur 服务 quotidien.",
    );

    expect(detected).toBe("fr");
  });

  test("text too short returns null", () => {
    expect(detectLanguage("Software Engineer")).toBeNull();
  });
});
