import { copy } from "../../shared/copy.ts";
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
