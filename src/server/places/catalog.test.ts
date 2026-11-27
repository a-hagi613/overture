import { describe, expect, test } from "bun:test";

import { suggestPlaces } from "../catalog/geo-suggest.ts";
import {
  countryCodesOfPlaceIds,
  describePlaceIds,
  locationTextsOfPlaceIds,
  placeSearchFacets,
} from "./catalog.ts";

describe("the place picker's suggestions", () => {
  test("a city suggestion carries the canonical id and its region and country", () => {
    const [toronto] = suggestPlaces("toronto");

    expect(toronto).toEqual({
      id: "city:ca:toronto",
      kind: "city",
      label: "Toronto",
      meta: "Ontario, Canada",
    });
  });

  test("remote scopes are offered beside the physical place", () => {
    const ids = suggestPlaces("canada", 20).map((place) => place.id);

    expect(ids).toContain("country:ca");
    expect(ids).toContain("remote:country:ca");
  });

  test("an empty query offers worldwide and the common hubs", () => {
    const ids = suggestPlaces("").map((place) => place.id);

    expect(ids).toContain("remote:worldwide");
    expect(ids).toContain("country:ca");
  });

  test("every suggestion is a place id and a free-text query is never one", () => {
    for (const place of suggestPlaces("berlin")) {
      expect(place.id).toMatch(/^(?:country|region|metro|city|remote):/u);
    }
  });
});

describe("describing stored place ids", () => {
  test("labels and second lines are readable", () => {
    expect(describePlaceIds(["country:ca", "remote:continent:EU", "remote:worldwide"])).toEqual([
      { id: "country:ca", kind: "country", label: "Canada", meta: "" },
      {
        id: "remote:continent:EU",
        kind: "remote_continent",
        label: "Remote · Europe",
        meta: "Europe",
      },
      {
        id: "remote:worldwide",
        kind: "remote_worldwide",
        label: "Remote · Worldwide",
        meta: "Anywhere",
      },
    ]);
  });

  test("a saved city becomes the search facets and the country its jobs can carry", () => {
    expect(placeSearchFacets(["city:ca:toronto"])).toEqual({
      cities: ["Toronto"],
      countries: ["ca"],
      metros: [],
      placeIds: ["city:ca:toronto"],
      regions: [],
    });
  });

  test("country codes follow cities, countries and continents", () => {
    expect(countryCodesOfPlaceIds(["city:ca:toronto", "remote:country:de"])).toEqual(["CA", "DE"]);
    expect(countryCodesOfPlaceIds(["remote:continent:EU"]).length).toBeGreaterThan(20);
  });

  test("the retired catalog readers get readable text", () => {
    expect(
      locationTextsOfPlaceIds(["city:ca:toronto", "remote:country:de", "remote:worldwide"]),
    ).toEqual(["Toronto, Canada", "Germany", "Remote"]);
  });
});
