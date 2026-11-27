import { copy, failedReasonText } from "../../shared/copy.ts";
import type { ApplicationDetail } from "./board-api.ts";

export function stamp(at: number, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(at));

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  }).format(new Date(at));

  return `${date} · ${time}`;
}

export function stageLabel(value: string | null) {
  switch (value) {
    case "queued": {
      return copy.board.columns.queued;
    }

    case "ready": {
      return copy.board.columns.ready;
    }

    case "applied": {
      return copy.board.columns.applied;
    }

    case "screening": {
      return copy.board.columns.screening;
    }

    case "interviewing": {
      return copy.board.columns.interviewing;
    }

    case "offer": {
      return copy.board.columns.offer;
    }

    case "closed": {
      return copy.board.columns.closed;
    }

    default: {
      return null;
    }
  }
}

export function stageOf(value: string | undefined) {
  switch (value) {
    case "queued": {
      return "queued";
    }

    case "ready": {
      return "ready";
    }

    case "applied": {
      return "applied";
    }

    case "screening": {
      return "screening";
    }

    case "interviewing": {
      return "interviewing";
    }

    case "offer": {
      return "offer";
    }

    case "closed": {
      return "closed";
    }

    default: {
      return null;
    }
  }
}

export function money(detail: ApplicationDetail) {
  const { salaryCurrency, salaryMaxMinor, salaryMinMinor, salaryPeriod } = detail.posting;

  if (salaryMinMinor === null || salaryCurrency === null) {
    return null;
  }

  const period = salaryPeriod ?? "year";
  let divisor = 100;
  let suffix = "/hr";

  if (period === "year") {
    divisor = 100_000;
    suffix = "k";
  } else if (period === "month") {
    suffix = "/mo";
  }

  const minimum = String(Math.round(salaryMinMinor / divisor));
  const maximum = salaryMaxMinor === null ? null : String(Math.round(salaryMaxMinor / divisor));

  return copy.board.salary(minimum, maximum, salaryCurrency, suffix);
}

export function providerName(provider: string) {
  switch (provider) {
    case "ashby": {
      return "Ashby";
    }

    case "browser_use": {
      return "Overture Auto-Apply";
    }

    case "greenhouse": {
      return "Greenhouse";
    }

    case "lever": {
      return "Lever";
    }

    case "personio": {
      return "Personio";
    }

    case "workable": {
      return "Workable";
    }

    default: {
      return provider;
    }
  }
}

export function kilobytes(bytes: number) {
  return copy.board.dossier.fileKb(Math.round(bytes / 1024));
}

const TIMELINE_REASONS = new Map<string, string>([
  ["approval_invalidated", copy.board.timeline.reasons.approval_invalidated],
  ["ats_flagged", copy.board.timeline.reasons.ats_flagged],
  ["confirmation_email", copy.board.timeline.reasons.confirmation_email],
  ["confirmation_page", copy.board.timeline.reasons.confirmation_page],
  ["confirm_wait_elapsed", copy.board.timeline.reasons.confirm_wait_elapsed],
  ["dry_submit", copy.board.timeline.reasons.dry_submit],
  ["form_changed", copy.board.timeline.reasons.form_changed],
  ["login_wall", copy.board.timeline.reasons.login_wall],
  ["mail", copy.board.timeline.reasons.mail],
  ["posting_closed", copy.board.timeline.reasons.posting_closed],
  ["posting_identity", copy.board.timeline.reasons.posting_identity],
  ["prepare_problem", copy.board.timeline.reasons.prepare_problem],
  ["retry_scheduled", copy.board.timeline.reasons.retry_scheduled],
  ["review_dismissed", copy.board.timeline.reasons.review_dismissed],
  ["selected_automatically", copy.board.timeline.reasons.selected_automatically],
  ["selected_by_user", copy.board.timeline.reasons.selected_by_user],
  ["user_withdraw", copy.board.timeline.reasons.user_withdraw],
]);

/**
 * The plain sentence for a recorded timeline reason. Machine-only reasons never
 * reach the screen as tokens; an unknown reason stays unshown and the event's
 * own sentence carries the meaning instead.
 * @param reason The stored reason, when the event has one.
 * @returns The sentence to show, or null when there is nothing honest to add.
 */
export function timelineReasonText(reason: string | null) {
  if (reason === null || reason === "") {
    return null;
  }

  if (reason.startsWith("checkin:")) {
    const answer = reason.slice("checkin:".length);

    return answer === "no_response"
      ? "The employer did not reply."
      : copy.board.timeline.reasons.checkin(answer);
  }

  if (reason.startsWith("mail:")) {
    return copy.board.timeline.reasons.mail;
  }

  if (reason.startsWith("posting_identity:")) {
    return copy.board.timeline.reasons.posting_identity;
  }

  return TIMELINE_REASONS.get(reason) ?? failedReasonText(reason) ?? null;
}

/**
 * How a posting's work mode reads in the drawer. Freehire leaves it blank on
 * most postings, and the drawer says so rather than guessing.
 * @param workplace The stored workplace, or null when the catalog has none.
 * @returns The label to show.
 */
export function workModeText(workplace: "remote" | "hybrid" | "onsite" | null) {
  if (workplace === null) {
    return copy.board.job.workModeNotStated;
  }

  return copy.board.job.workModes[workplace];
}
