import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { METRIC_NAMES } from "./metrics.ts";

const dashboardPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "ops",
  "grafana",
  "overture-prod-dashboard.json",
);

interface DashboardPanel {
  title?: string | undefined;
  type?: string | undefined;
  panels?: DashboardPanel[] | undefined;
  targets?: { expr?: string | undefined }[] | undefined;
}

const panelSchema: z.ZodType<DashboardPanel> = z.lazy(() =>
  z.object({
    panels: z.array(panelSchema).optional(),
    targets: z.array(z.object({ expr: z.string().optional() })).optional(),
    title: z.string().optional(),
    type: z.string().optional(),
  }),
);

const dashboardSchema = z.object({
  panels: z.array(panelSchema),
  schemaVersion: z.number(),
  templating: z
    .object({
      list: z
        .array(z.object({ name: z.string().optional(), type: z.string().optional() }))
        .optional(),
    })
    .optional(),
  uid: z.string().optional(),
});

function readDashboard() {
  return dashboardSchema.parse(JSON.parse(readFileSync(dashboardPath, "utf8")));
}

function panelsOf(dashboard: z.infer<typeof dashboardSchema>) {
  return dashboard.panels.flatMap((panel) => [panel, ...(panel.panels ?? [])]);
}

test("the committed Grafana dashboard is valid JSON importable by fly-metrics.net", () => {
  const dashboard = readDashboard();

  expect(dashboard.uid).toBe("overture-prod");
  expect(dashboard.templating?.list?.some((entry) => entry.type === "datasource")).toBe(true);

  const rows = dashboard.panels.filter((panel) => panel.type === "row");
  const titles = rows.map((row) => row.title);

  expect(titles).toEqual([
    "Runtime & Catalog",
    "API Latency",
    "Apply & ATS Health",
    "LLM & Tagging",
    "Queue, Mail & Billing",
    "Fly System Resources",
  ]);

  for (const row of rows) {
    expect((row.panels ?? []).length).toBeGreaterThan(0);
  }
});

test("every overture_* expression in the dashboard names an exported metric", () => {
  const dashboard = readDashboard();
  const exported = new Set<string>(Object.values(METRIC_NAMES));
  const referenced = new Set<string>();

  for (const panel of panelsOf(dashboard)) {
    for (const target of panel.targets ?? []) {
      for (const match of (target.expr ?? "").matchAll(/overture_[a-z0-9_]+/gu)) {
        const [name = ""] = match;
        const base = name.replace(/_(?:bucket|count|sum)$/u, "");

        referenced.add(exported.has(name) ? name : base);
      }
    }
  }

  expect(referenced.size).toBeGreaterThan(0);

  for (const name of referenced) {
    expect(exported.has(name)).toBe(true);
  }

  for (const name of exported) {
    expect(referenced.has(name)).toBe(true);
  }
});

test("the dashboard never queries a high-cardinality identifier label", () => {
  const source = readFileSync(dashboardPath, "utf8");

  for (const forbidden of ["user_id", "job_id", "http.url", "email="]) {
    expect(source).not.toContain(forbidden);
  }
});
