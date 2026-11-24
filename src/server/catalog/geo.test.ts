import { describe, expect, test } from "bun:test";

import {
  haversineKm,
  isRemoteLocationText,
  normalizePlaceName,
  postingLocationScopes,
  resolveLocation,
  resolveLocationQuery,
  resolvePlaceQuery,
  sameRegion,
} from "./geo.ts";

describe("resolveLocation", () => {
  test("a city, state abbreviation and country read right to left", () => {
    const location = resolveLocation("San Francisco, CA, USA");

    expect(location.countryCode).toBe("US");
    expect(location.region).toBe("California");
    expect(location.city).toBe("San Francisco");
  });

  test("a city and state abbreviation without the country name", () => {
    const location = resolveLocation("San Francisco, CA");

    expect(location.countryCode).toBe("US");
    expect(location.region).toBe("California");
    expect(location.city).toBe("San Francisco");
  });

  test("a region name beats a smaller same-named city", () => {
    const location = resolveLocation("Ontario");

    expect(location.countryCode).toBe("CA");
    expect(location.region).toBe("Ontario");
    expect(location.regionCode).toBe("CA.08");
    expect(location.city).toBeNull();
  });

  test("London, ON resolves to London, Ontario even though London, GB is bigger", () => {
    const location = resolveLocation("London, ON, Canada");

    expect(location.countryCode).toBe("CA");
    expect(location.region).toBe("Ontario");
    expect(location.regionCode).toBe("CA.08");
    expect(location.city).toBe("London");
  });

  test("a bare London still resolves to the largest London", () => {
    const location = resolveLocation("London");

    expect(location.countryCode).toBe("GB");
    expect(location.city).toBe("London");
  });

  test("a ran city keeps its own region", () => {
    const location = resolveLocation("Toronto, ON, Canada");

    expect(location.region).toBe("Ontario");
    expect(location.city).toBe("Toronto");
  });

  test("remote text still resolves the country it is scoped to", () => {
    expect(resolveLocation("Remote, USA")).toEqual({
      city: null,
      countryCode: "US",
      region: null,
      regionCode: null,
    });
  });

  test("a city-state keeps both its city and country", () => {
    expect(resolveLocation("Singapore")).toEqual({
      city: "Singapore",
      countryCode: "SG",
      region: null,
      regionCode: null,
    });
  });

  test("a legacy admin1 code compares equal to its region name", () => {
    expect(sameRegion("CA", "08", "Ontario")).toBe(true);
    expect(sameRegion("DE", "16", "Bavaria")).toBe(false);
  });
});

describe("resolvePlaceQuery", () => {
  test("Ontario is a region, not the small US city", () => {
    const resolved = resolvePlaceQuery("Ontario");

    expect(resolved.kind).toBe("region");
    expect(resolved.regionIsoCode).toBe("CA-ON");
    expect(resolved.cityGeonameId).toBeNull();
  });

  test("Europe is a continent scope", () => {
    const resolved = resolvePlaceQuery("Europe");

    expect(resolved.kind).toBe("continent");
    expect(resolved.continentCodes).toEqual(["EU"]);
  });

  test("Canada is a country scope", () => {
    const resolved = resolvePlaceQuery("Canada");

    expect(resolved.kind).toBe("country");
    expect(resolved.countryCodes).toEqual(["CA"]);
  });

  test("a colloquial metro resolves to its bounding box", () => {
    const resolved = resolvePlaceQuery("Bay Area");

    expect(resolved.kind).toBe("metro");
    expect(resolved.metroName).toBe("Bay Area");
    expect(resolved.metroBbox).not.toBeNull();
  });

  test("GTA resolves through its alias", () => {
    expect(resolvePlaceQuery("greater toronto area").metroName).toBe("GTA");
  });

  test("a remote string names its remote scope", () => {
    const resolved = resolvePlaceQuery("Remote - Canada");

    expect(resolved.remote).toBe(true);
    expect(resolved.kind).toBe("country");
    expect(resolved.countryCodes).toEqual(["CA"]);
  });

  test("a city carries its coordinates for a radius search", () => {
    const resolved = resolvePlaceQuery("Toronto");

    expect(resolved.kind).toBe("city");
    expect(resolved.lat).toBeCloseTo(43.65, 1);
    expect(resolved.lon).toBeCloseTo(-79.38, 1);
  });
});

describe("resolveLocationQuery", () => {
  test("parses every group of a multi-location string", () => {
    const groups = resolveLocationQuery("Toronto; Vancouver | Berlin");

    expect(groups.map((group) => group.cityName)).toEqual(["Toronto", "Vancouver", "Berlin"]);
  });

  test("keeps a remote group's scope", () => {
    const groups = resolveLocationQuery("Remote - Canada; Berlin");

    expect(groups.filter((group) => group.remote)).toHaveLength(1);
    expect(groups.find((group) => group.cityName === "Berlin")?.remote).toBe(false);
  });
});

describe("postingLocationScopes", () => {
  test("an on-site city row keeps every coarser level", () => {
    expect(
      postingLocationScopes({ locationRaw: "Toronto, ON, Canada", workplace: "onsite" }),
    ).toEqual([
      {
        continentCode: "NA",
        countryCode: "CA",
        regionCode: "CA-ON",
        cityGeonameId: 6_167_865,
        scopeKind: "onsite",
      },
    ]);
  });

  test("a hybrid posting is tagged hybrid", () => {
    expect(
      postingLocationScopes({ locationRaw: "Toronto, ON, Canada", workplace: "hybrid" })[0]
        ?.scopeKind,
    ).toBe("hybrid");
  });

  test("Remote - Canada becomes a remote_country scope", () => {
    expect(postingLocationScopes({ locationRaw: "Remote - Canada", workplace: "remote" })).toEqual([
      {
        continentCode: "NA",
        countryCode: "CA",
        regionCode: null,
        cityGeonameId: null,
        scopeKind: "remote_country",
      },
    ]);
  });

  test("a bare Remote is a remote_global scope", () => {
    expect(postingLocationScopes({ locationRaw: "Remote", workplace: "remote" })).toEqual([
      {
        continentCode: null,
        countryCode: null,
        regionCode: null,
        cityGeonameId: null,
        scopeKind: "remote_global",
      },
    ]);
  });

  test("a remote continent scope keeps the continent", () => {
    const scopes = postingLocationScopes({ locationRaw: "Remote - Europe", workplace: "remote" });

    expect(scopes).toEqual([
      {
        continentCode: "EU",
        countryCode: null,
        regionCode: null,
        cityGeonameId: null,
        scopeKind: "remote_continent",
      },
    ]);
  });

  test("a multi-location posting contributes one row per place", () => {
    const scopes = postingLocationScopes({
      locationRaw: "Toronto; Vancouver",
      workplace: "onsite",
    });

    expect(scopes.map((scope) => scope.countryCode)).toEqual(["CA", "CA"]);
    expect(scopes).toHaveLength(2);
  });
});

describe("helpers", () => {
  test("normalizePlaceName folds diacritics and punctuation", () => {
    expect(normalizePlaceName("São Paulo!")).toBe("sao paulo");
  });

  test("remote keywords are recognized case-insensitively", () => {
    expect(isRemoteLocationText("Work from home")).toBe(true);
    expect(isRemoteLocationText("Berlin, Germany")).toBe(false);
  });

  test("haversine measures Toronto to Mississauga", () => {
    const distance = haversineKm({ lat: 43.6533, lon: -79.3839 }, { lat: 43.5789, lon: -79.6583 });

    expect(distance).toBeGreaterThan(20);
    expect(distance).toBeLessThan(30);
  });
});
