export const CHECKIN_ANSWERS = ["rejected", "interviewing", "still_waiting"] as const;

export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];
