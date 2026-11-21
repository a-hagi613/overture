export interface PlannedResume {
  fieldName: string | null;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export const cssValue = (raw: string) => raw.replaceAll(/["\\]/gu, String.raw`\$&`);

export const normText = (raw: string | null) =>
  (raw ?? "").replaceAll(/\s+/gu, " ").trim().toLowerCase();
