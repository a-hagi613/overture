import { copy } from "../../../shared/copy.ts";

export const percent = (rate: number | null) =>
  rate === null ? copy.admin.reportNone : copy.admin.reportRate(rate);

export const seconds = (millis: number | null) =>
  millis === null ? copy.admin.reportNone : copy.admin.reportSeconds(millis);

export const megabytes = (value: number | null) =>
  value === null ? copy.admin.reportNone : copy.admin.reportMegabytes(value);

export const dollars = (micros: number | null) =>
  micros === null ? copy.admin.reportNone : copy.admin.reportDollars(micros);
