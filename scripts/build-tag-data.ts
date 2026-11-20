import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function buildCities() {
  const [citiesText, admin1Text, countryText] = await Promise.all([
    downloadZipText("https://download.geonames.org/export/dump/cities15000.zip", "cities15000.txt"),
    downloadText("https://download.geonames.org/export/dump/admin1CodesASCII.txt"),
    downloadText("https://download.geonames.org/export/dump/countryInfo.txt"),
  ]);

  const regions: Record<string, string> = {};

  for (const line of admin1Text.split("\n")) {
    const [code, name] = line.split("\t");

    if (code !== undefined && name !== undefined) {
      regions[code] = name;
    }
  }

  const countryNames: Record<string, string> = {};

  for (const line of countryText.split("\n")) {
    if (line.startsWith("#")) {
      continue;
    }

    const [code, isoAlpha3, isoNumeric, fips, name] = line.split("\t");

    if (isoAlpha3 === undefined || isoNumeric === undefined || fips === undefined) {
      continue;
    }

    if (code !== undefined && name !== undefined) {
      countryNames[code] = name;
    }
  }

  const cityRows: [string, string, string, string, number][] = [];

  for (const line of citiesText.split("\n")) {
    const [
      geonameid,
      featureCode1,
      name,
      alternates,
      featureCode2,
      featureCode3,
      featureClass,
      featureCode4,
      country,
      featureCode5,
      admin1,
      featureCode6,
      featureCode7,
      featureCode8,
      population,
    ] = line.split("\t");

    if (
      featureCode1 === undefined ||
      featureCode2 === undefined ||
      featureCode3 === undefined ||
      featureCode4 === undefined ||
      featureCode5 === undefined ||
      featureCode6 === undefined ||
      featureCode7 === undefined ||
      featureCode8 === undefined
    ) {
      continue;
    }

    const residents = Number(population);

    if (
      geonameid === undefined ||
      geonameid === "" ||
      featureClass === undefined ||
      featureClass !== "P" ||
      name === undefined ||
      name === "" ||
      country === undefined ||
      country === "" ||
      !Number.isFinite(residents)
    ) {
      continue;
    }

    cityRows.push([name, country, admin1 ?? "", alternates ?? "", residents]);
  }

  cityRows.sort((a, b) => b[4] - a[4]);
  const seen = new Set<string>();
  const cities: string[][] = [];

  for (const [name, country, admin1, alternates] of cityRows) {
    const key = `${normalizeTitle(name)}|${country}|${admin1}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const trimmedAlternates = alternates
      .split(",")
      .map((alternate) => alternate.trim())
      .filter(
        (alternate) =>
          /^[A-Za-z][A-Za-z '-]{2,29}$/u.test(alternate) &&
          normalizeTitle(alternate) !== normalizeTitle(name),
      )
      .slice(0, 2);

    cities.push([name, country, admin1, ...trimmedAlternates]);
  }

  const dataset = { cities, regions, countries: countryNames };

  await mkdir("src/server/catalog/data", { recursive: true });
  await writeFile("src/server/catalog/data/geonames-cities.json", `${JSON.stringify(dataset)}\n`);
  process.stdout.write(
    `geonames-cities.json: ${String(cities.length)} cities, ${String(Object.keys(regions).length)} regions\n`,
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

  await mkdir("src/server/catalog/data", { recursive: true });
  await writeFile("src/server/catalog/data/onet-titles.json", `${JSON.stringify(occupations)}\n`);
  process.stdout.write(
    `onet-titles.json: ${String(occupations.length)} occupations, ${String(alternateCount)} alternate titles\n`,
  );
}

await buildCities();

await buildOnet();
