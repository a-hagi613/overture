import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTINENTS, METRO_AREAS, isoRegionCodeFor } from "../src/server/catalog/geo-static.ts";

const ROLE_GROUPS = [
  "Software Engineering",
  "Data & Analytics",
  "Machine Learning & AI",
  "Product Management",
  "Design",
  "DevOps & Infrastructure",
  "Security",
  "IT & Support Engineering",
  "QA & Test",
  "Hardware & Embedded",
  "Sales",
  "Customer Success",
  "Customer Support",
  "Marketing",
  "Communications & PR",
  "Finance",
  "Accounting",
  "Legal",
  "People & HR",
  "Recruiting",
  "Operations",
  "Supply Chain & Logistics",
  "Project & Program Management",
  "Business Development & Partnerships",
  "Healthcare",
  "Education",
  "Research & Science",
  "Administrative",
];

type RoleGroup = (typeof ROLE_GROUPS)[number];

const socRoles = new Map<string, RoleGroup>(
  Object.entries({
    "11-1011": "Operations",
    "11-1021": "Operations",
    "11-2011": "Marketing",
    "11-2021": "Marketing",
    "11-2022": "Sales",
    "11-2032": "Communications & PR",
    "11-2033": "Marketing",
    "11-3012": "Operations",
    "11-3013": "Operations",
    "11-3021": "Software Engineering",
    "11-3031": "Finance",
    "11-3061": "Supply Chain & Logistics",
    "11-3071": "Supply Chain & Logistics",
    "11-3111": "People & HR",
    "11-3121": "People & HR",
    "11-3131": "People & HR",
    "11-9031": "Education",
    "11-9032": "Education",
    "11-9033": "Education",
    "11-9039": "Education",
    "11-9041": "Hardware & Embedded",
    "11-9111": "Healthcare",
    "13-1021": "Supply Chain & Logistics",
    "13-1022": "Supply Chain & Logistics",
    "13-1023": "Supply Chain & Logistics",
    "13-1041": "Legal",
    "13-1041.07": "Legal",
    "13-1071": "People & HR",
    "13-1075": "People & HR",
    "13-1141": "People & HR",
    "13-1151": "People & HR",
    "13-1081": "Supply Chain & Logistics",
    "13-1081.01": "Supply Chain & Logistics",
    "13-1081.02": "Supply Chain & Logistics",
    "13-1082": "Project & Program Management",
    "13-1111": "Operations",
    "13-1161": "Marketing",
    "13-1161.01": "Marketing",
    "13-1199.07": "Security",
    "13-2011": "Accounting",
    "13-2031": "Finance",
    "13-2041": "Finance",
    "13-2051": "Finance",
    "13-2052": "Finance",
    "13-2053": "Finance",
    "13-2054": "Finance",
    "13-2071": "Finance",
    "13-2072": "Finance",
    "13-2081": "Accounting",
    "13-2082": "Accounting",
    "13-2099": "Finance",
    "13-2099.01": "Data & Analytics",
    "15-1211": "Software Engineering",
    "15-1211.01": "Software Engineering",
    "15-1212": "Security",
    "15-1221": "Machine Learning & AI",
    "15-1231": "IT & Support Engineering",
    "15-1232": "IT & Support Engineering",
    "15-1241": "DevOps & Infrastructure",
    "15-1241.01": "DevOps & Infrastructure",
    "15-1242": "DevOps & Infrastructure",
    "15-1243": "Data & Analytics",
    "15-1243.01": "Data & Analytics",
    "15-1251": "Software Engineering",
    "15-1252": "Software Engineering",
    "15-1253": "QA & Test",
    "15-1254": "Design",
    "15-1255": "Software Engineering",
    "15-1299.01": "DevOps & Infrastructure",
    "15-1299.02": "Data & Analytics",
    "15-1299.03": "Operations",
    "15-1299.04": "Security",
    "15-1299.05": "Security",
    "15-1299.06": "Security",
    "15-1299.07": "Software Engineering",
    "15-1299.08": "DevOps & Infrastructure",
    "15-1299.09": "Project & Program Management",
    "15-2011": "Finance",
    "15-2021": "Data & Analytics",
    "15-2031": "Data & Analytics",
    "15-2041": "Data & Analytics",
    "15-2041.01": "Data & Analytics",
    "15-2051": "Machine Learning & AI",
    "15-2051.01": "Data & Analytics",
    "15-2051.02": "Data & Analytics",
    "15-2099": "Data & Analytics",
    "15-2099.01": "Data & Analytics",
    "17-2061": "Hardware & Embedded",
    "17-2071": "Hardware & Embedded",
    "17-2072": "Hardware & Embedded",
    "17-2112": "QA & Test",
    "17-2112.02": "QA & Test",
    "17-3012": "Hardware & Embedded",
    "17-3013": "Hardware & Embedded",
    "17-3023": "Hardware & Embedded",
    "27-3031": "Communications & PR",
    "27-3043": "Communications & PR",
    "43-1011": "Operations",
    "43-4051": "Customer Support",
    "43-4151": "Customer Support",
    "43-6011": "Administrative",
    "43-6014": "Administrative",
    "43-9022": "Administrative",
    "43-9061": "Administrative",
    "43-5061": "Supply Chain & Logistics",
  }),
);

const prefixRoles = new Map<string, RoleGroup>(
  Object.entries({
    "19-": "Research & Science",
    "25-": "Education",
    "27-10": "Design",
    "29-": "Healthcare",
    "31-": "Healthcare",
    "41-": "Sales",
  }),
);

function socRole(soc: string) {
  const exact = socRoles.get(soc);

  if (exact !== undefined) {
    return exact;
  }

  const dot = soc.indexOf(".");
  const base = dot === -1 ? soc : soc.slice(0, dot);
  const baseRole = socRoles.get(base);

  if (baseRole !== undefined) {
    return baseRole;
  }

  const matching = [...socRoles.keys()].find((key) => soc.startsWith(key));

  if (matching !== undefined) {
    const matched = socRoles.get(matching);

    if (matched !== undefined) {
      return matched;
    }

    return null;
  }

  for (const [prefix, role] of prefixRoles) {
    if (soc.startsWith(prefix)) {
      return role;
    }
  }

  return null;
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

async function downloadText(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${String(response.status)}`);
  }

  return response.text();
}

async function downloadZipText(url: string, entryName: string) {
  const archive = await fetch(url);

  if (!archive.ok) {
    throw new Error(`GET ${url} failed: ${String(archive.status)}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "tagdata-"));
  const zipPath = join(dir, "data.zip");

  await writeFile(zipPath, new Uint8Array(await archive.arrayBuffer()));
  const process = Bun.spawnSync(["unzip", "-p", zipPath, entryName], { stdout: "pipe" });

  await rm(dir, { recursive: true });

  return new TextDecoder().decode(process.stdout);
}

type CompactCity = [number, string, string, string, number, number, number, string];

interface GeoDataset {
  published: string;
  countries: Record<string, string>;
  countryContinents: Record<string, string>;
  continents: Record<string, string>;
  regions: Record<string, string>;
  regionIso: Record<string, string>;
  metros: {
    name: string;
    aliases: string[];
    countryCode: string;
    isoRegionCode: string | null;
    continentCode: string;
    bbox: number[];
  }[];
  cities: CompactCity[];
}

const LATIN_NAME = /^[A-Za-z][A-Za-z '.-]{2,39}$/u;

function compactCityLine(
  geonameId: string,
  name: string,
  country: string,
  admin1: string,
  lat: string,
  lon: string,
  population: string,
  alternates: string,
) {
  const residents = Number(population);
  const latitude = Number(lat);
  const longitude = Number(lon);
  const id = Number(geonameId);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(residents)
  ) {
    return null;
  }

  const normalizedName = normalizeTitle(name);
  const seen = new Set([normalizedName]);
  const keptAlternates: string[] = [];

  for (const alternate of alternates.split(",")) {
    const trimmed = alternate.trim();
    const normalized = normalizeTitle(trimmed);

    if (!LATIN_NAME.test(trimmed) || normalized === "" || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    keptAlternates.push(trimmed);

    if (keptAlternates.length >= 3) {
      break;
    }
  }

  return [
    id,
    name.trim(),
    country,
    admin1,
    Math.round(latitude * 10_000) / 10_000,
    Math.round(longitude * 10_000) / 10_000,
    Math.max(0, Math.trunc(residents)),
    keptAlternates.join("|"),
  ] satisfies CompactCity;
}

async function buildGeoPlaces() {
  const [citiesText, admin1Text, countryText] = await Promise.all([
    downloadZipText("https://download.geonames.org/export/dump/cities500.zip", "cities500.txt"),
    downloadText("https://download.geonames.org/export/dump/admin1CodesASCII.txt"),
    downloadText("https://download.geonames.org/export/dump/countryInfo.txt"),
  ]);

  const regions: Record<string, string> = {};
  const regionIso: Record<string, string> = {};

  for (const line of admin1Text.split("\n")) {
    const [code, name] = line.split("\t");

    if (code === undefined || name === undefined || code === "" || name === "") {
      continue;
    }

    regions[code] = name;
    const [country] = code.split(".");

    if (country !== undefined) {
      const suffix = code.slice(country.length + 1);

      regionIso[code] = isoRegionCodeFor(country, suffix);
    }
  }

  const countries: Record<string, string> = {};
  const countryContinents: Record<string, string> = {};

  for (const line of countryText.split("\n")) {
    if (line.startsWith("#")) {
      continue;
    }

    const columns = line.split("\t");
    const [code, isoAlpha3, isoNumeric, fips, name] = columns;
    const continent = columns.at(8);

    if (
      isoAlpha3 === undefined ||
      isoNumeric === undefined ||
      fips === undefined ||
      code === undefined ||
      name === undefined ||
      code === "" ||
      name === ""
    ) {
      continue;
    }

    countries[code] = name;

    if (continent !== undefined && continent !== "" && CONTINENTS.has(continent)) {
      countryContinents[code] = continent;
    }
  }

  const seen = new Set<string>();
  const cities: CompactCity[] = [];

  for (const line of citiesText.split("\n")) {
    const columns = line.split("\t");
    const geonameid = columns.at(0);
    const name = columns.at(2);
    const alternates = columns.at(3);
    const lat = columns.at(4);
    const lon = columns.at(5);
    const featureClass = columns.at(6);
    const featureCode = columns.at(7);
    const country = columns.at(8);
    const admin1 = columns.at(10);
    const population = columns.at(14);

    if (
      featureClass !== "P" ||
      geonameid === undefined ||
      name === undefined ||
      name === "" ||
      country === undefined ||
      country === "" ||
      lat === undefined ||
      lon === undefined ||
      featureCode === "PPLX"
    ) {
      continue;
    }

    const city = compactCityLine(
      geonameid,
      name,
      country,
      admin1 ?? "",
      lat,
      lon,
      population ?? "0",
      alternates ?? "",
    );

    if (city === null) {
      continue;
    }

    const key = `${normalizeTitle(city[1])}|${city[2]}|${city[3]}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cities.push(city);
  }

  cities.sort((left, right) => right[6] - left[6]);

  const dataset: GeoDataset = {
    published: new Date().toISOString().slice(0, 10),
    countries,
    countryContinents,
    continents: Object.fromEntries(CONTINENTS),
    regions,
    regionIso,
    metros: METRO_AREAS.map((metro) => ({
      name: metro.name,
      aliases: [...metro.aliases],
      countryCode: metro.countryCode,
      isoRegionCode: metro.isoRegionCode,
      continentCode: metro.continentCode,
      bbox: [...metro.bbox],
    })),
    cities,
  };

  await mkdir("src/server/catalog/tag-data", { recursive: true });
  await writeFile("src/server/catalog/tag-data/geo-places.json", `${JSON.stringify(dataset)}\n`);
  process.stdout.write(
    `geo-places.json: ${String(cities.length)} cities, ${String(Object.keys(regions).length)} regions, ${String(dataset.metros.length)} metros\n`,
  );
}

interface OnetTitleRow {
  soc: string;
  title: string;
  role: RoleGroup;
  alternates: string[];
}

async function buildOnet() {
  const [occupationText, alternatesText] = await Promise.all([
    downloadZipText(
      "https://www.onetcenter.org/dl_files/database/db_29_2_text.zip",
      "db_29_2_text/Occupation Data.txt",
    ),
    downloadZipText(
      "https://www.onetcenter.org/dl_files/database/db_29_2_text.zip",
      "db_29_2_text/Alternate Titles.txt",
    ),
  ]);

  const titlesBySoc = new Map<string, OnetTitleRow>();

  for (const line of occupationText.split("\n").slice(1)) {
    const [soc, title] = line.split("\t");

    if (soc === undefined || soc === "" || title === undefined || title === "") {
      continue;
    }

    const assigned = socRole(soc);

    if (assigned !== null) {
      titlesBySoc.set(soc, { soc, title, role: assigned, alternates: [] });
    }
  }

  for (const line of alternatesText.split("\n").slice(1)) {
    const [soc, alternate] = line.split("\t");

    if (soc === undefined || alternate === undefined || alternate === "" || alternate === "n/a") {
      continue;
    }

    const row = titlesBySoc.get(soc);

    if (row === undefined) {
      continue;
    }

    if (!row.alternates.some((title) => normalizeTitle(title) === normalizeTitle(alternate))) {
      row.alternates.push(alternate);
    }
  }

  const occupations = [...titlesBySoc.values()];
  const alternateCount = occupations.reduce((sum, row) => sum + row.alternates.length, 0);

  await mkdir("src/server/catalog/tag-data", { recursive: true });
  await writeFile(
    "src/server/catalog/tag-data/onet-titles.json",
    `${JSON.stringify(occupations)}\n`,
  );
  process.stdout.write(
    `onet-titles.json: ${String(occupations.length)} occupations, ${String(alternateCount)} alternate titles\n`,
  );
}

await buildGeoPlaces();

await buildOnet();
