export type GreenhouseBoardRegion = "us" | "eu";

export const GREENHOUSE_BOARD_ORIGINS = {
  us: "https://job-boards.greenhouse.io",
  eu: "https://job-boards.eu.greenhouse.io",
} as const satisfies Record<GreenhouseBoardRegion, string>;

export function greenhouseBoardUrl(input: {
  boardToken: string;
  atsJobId: string;
  region: GreenhouseBoardRegion;
  origin: string | undefined;
}) {
  const origin = input.origin ?? GREENHOUSE_BOARD_ORIGINS[input.region];
  const query = new URLSearchParams({ for: input.boardToken, token: input.atsJobId });

  return `${origin}/embed/job_app?${query.toString()}`;
}
