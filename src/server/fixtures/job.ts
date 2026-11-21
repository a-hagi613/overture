import { z } from "zod";

import type { CapturedFixture, FixtureCaptureDeps } from "./capture.ts";

import { ATS_NAMES, captureFixtures } from "./capture.ts";

export const FIXTURE_CAPTURE_JOB_KIND = "fixtures.capture";

export const fixtureCapturePayloadSchema = z.object({
  ats: z.enum(ATS_NAMES),
  applyUrls: z.array(z.url()).min(1).max(10),
});

export type FixtureCapturePayload = z.infer<typeof fixtureCapturePayloadSchema>;

export function parseFixtureCapturePayload(payload: string) {
  return fixtureCapturePayloadSchema.parse(JSON.parse(payload));
}

export async function runFixtureCaptureJob(deps: FixtureCaptureDeps, payload: string) {
  const parsed = parseFixtureCapturePayload(payload);

  return captureFixtures(deps, parsed);
}

export type FixtureCaptureResult = CapturedFixture[];
