import type { Ats } from "../../shared/ats.ts";
import { atsJobIdOf, atsForFreehireSource, boardTokenOf } from "../../shared/freehire.ts";
import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { FREEHIRE_DEFAULT_BASE_URL } from "./freehire-source.ts";
import type { FetchLike } from "./source.ts";

export interface ApplyTarget {
  ats: Ats;
  boardToken: string;
  atsJobId: string;
  /** The employer's application page; a direct ATS URL when Overture can build one, otherwise the go target. */
  applyUrl: string;
  /** `direct` when formatted from the ATS and board token, `go` when freehire's redirect was followed once. */
  via: "direct" | "go";
}

export interface ApplyLinkOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * The employer application URL for the boards whose shape is known, so no redirect costs a request.
 * @param ats The ATS name.
 * @param boardToken The freehire board token.
 * @param atsJobId The employer's job id.
 * @returns The apply URL, or null for a board that needs the go redirect.
 */
export function directApplyUrl(ats: Ats, boardToken: string, atsJobId: string) {
  if (boardToken === "" || atsJobId === "") {
    return null;
  }

  if (ats === "lever") {
    return `https://jobs.lever.co/${boardToken}/${atsJobId}/apply`;
  }

  if (ats === "greenhouse") {
    return `https://job-boards.greenhouse.io/${boardToken}/jobs/${atsJobId}`;
  }

  if (ats === "ashby") {
    return `https://jobs.ashbyhq.com/${boardToken}/${atsJobId}`;
  }

  return null;
}

/**
 * Removes freehire's `utm_*` tracking parameters from a target, keeping every other query parameter and the
 * fragment.
 * @param target The absolute URL to clean.
 * @returns The cleaned URL, or the input when it does not parse.
 */
export function stripUtm(target: string) {
  let parsed: URL;

  try {
    parsed = new URL(target);
  } catch {
    return target;
  }

  const keys = parsed.searchParams.keys().toArray();

  for (const key of keys) {
    if (key.startsWith("utm_")) {
      parsed.searchParams.delete(key);
    }
  }

  return parsed.toString();
}

/**
 * freehire's redirect for a posting: the `apply_url` it sent, or the `/go/<slug>` link when `apply_url` is blank.
 * @param job The freehire record.
 * @param baseUrl The freehire origin.
 * @returns The URL to request once without following redirects.
 */
export function goUrlFor(job: FreehireJobRecord, baseUrl = FREEHIRE_DEFAULT_BASE_URL) {
  const applyUrl = job.apply_url?.trim() ?? "";

  return applyUrl === ""
    ? `${baseUrl.replace(/\/+$/u, "")}/api/v1/go/${encodeURIComponent(job.public_slug)}`
    : applyUrl;
}

/**
 * Resolves the one application link Overture stores per job. Lever, Greenhouse and Ashby are formatted from the
 * board token in `external_id`; every other board is followed once through freehire's redirect without following
 * it, with `utm_*` stripped. A board outside the sendable set has no target.
 * @param job The freehire record.
 * @param options The freehire origin, the fetcher and the request timeout.
 * @returns The target, or null when the board is unsendable, the redirect fails or it has no Location.
 */
export async function resolveApplyTarget(job: FreehireJobRecord, options: ApplyLinkOptions = {}) {
  const ats = atsForFreehireSource(job.source);

  if (ats === null) {
    return null;
  }

  const boardToken = boardTokenOf(job.external_id);
  const atsJobId = atsJobIdOf(job.external_id);
  const direct = directApplyUrl(ats, boardToken, atsJobId);

  if (direct !== null) {
    return { applyUrl: direct, ats, atsJobId, boardToken, via: "direct" } satisfies ApplyTarget;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(goUrlFor(job, options.baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });

    await response.body?.cancel();

    const location = response.headers.get("location");

    if (location === null || location.trim() === "") {
      return null;
    }

    return {
      applyUrl: stripUtm(new URL(location).toString()),
      ats,
      atsJobId,
      boardToken,
      via: "go",
    } satisfies ApplyTarget;
  } catch {
    return null;
  }
}
