import { copy } from "../../shared/copy.ts";

export function longDate(iso: string) {
  return new Intl.DateTimeFormat(copy.legal.dateLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}
