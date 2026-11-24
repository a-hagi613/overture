import { z } from "zod";

import type { ObjectStore } from "../platform/ports/object-store.ts";

import { taggingReportSchema } from "../../shared/tagging-report.ts";

export { taggingReportSchema } from "../../shared/tagging-report.ts";

export type { TaggingReport } from "../../shared/tagging-report.ts";

const manifestTaggingSchema = z.object({
  version: z.string(),
  tagging: taggingReportSchema.optional(),
});

/**
 * Reads the tagging report out of the published catalog manifest (`catalog/latest.json`). The manifest is the same
 * object the runtime hot-swap already trusts, so the admin page reports the classification of the catalog it is
 * actually serving. A missing object store, a manifest written before WS-17a, a malformed document or a manifest
 * without a `tagging` block all answer `null` instead of failing the admin request.
 * @param deps The object store the manifest is published to and the manifest key.
 * @returns The manifest version and its tagging report, or nulls when there is nothing to show.
 */
export async function readPublishedTagging(deps: {
  key: string;
  objects: Pick<ObjectStore, "get">;
}) {
  const bytes = await deps.objects.get(deps.key).catch(() => null);

  if (bytes === null) {
    return { manifestVersion: null, tagging: null };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { manifestVersion: null, tagging: null };
  }

  const manifest = manifestTaggingSchema.safeParse(parsed);

  if (!manifest.success) {
    return { manifestVersion: null, tagging: null };
  }

  return {
    manifestVersion: manifest.data.version,
    tagging: manifest.data.tagging ?? null,
  };
}
