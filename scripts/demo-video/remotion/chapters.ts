export type ChapterId = "calendar" | "home" | "inbox" | "ready" | "resume" | "review" | "tracker";

export interface CursorBeat {
  /** Where the pointer enters, in full-screen [0..1] coordinates. */
  from: readonly [number, number];
  /** Where the pointer lands and clicks, in full-screen [0..1] coordinates. */
  to: readonly [number, number];
  /** Fraction of the clip at which the click lands. */
  clickAt: number;
}

export interface ChapterView {
  cursor: CursorBeat | null;
  focus: readonly [number, number];
  zoomFrom: number;
  zoomTo: number;
}

export interface Chapter {
  desktop: ChapterView;
  id: ChapterId;
  mobile: ChapterView;
  pill: string;
}

export interface Segment {
  chapter: ChapterId;
  durationInFrames: number;
  fadeIn: boolean;
  fadeOut: boolean;
  from: number;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    desktop: {
      cursor: { clickAt: 0.56, from: [0.42, 0.62], to: [0.935, 0.475] },
      focus: [0.74, 0.47],
      zoomFrom: 1,
      zoomTo: 1.24,
    },
    id: "home",
    mobile: {
      cursor: { clickAt: 0.56, from: [0.3, 0.72], to: [0.87, 0.82] },
      focus: [0.68, 0.74],
      zoomFrom: 1,
      zoomTo: 1.18,
    },
    pill: "Home · 90-day momentum",
  },
  {
    desktop: {
      cursor: { clickAt: 0.54, from: [0.64, 0.56], to: [0.868, 0.342] },
      focus: [0.82, 0.36],
      zoomFrom: 1,
      zoomTo: 1.24,
    },
    id: "ready",
    mobile: {
      cursor: { clickAt: 0.54, from: [0.78, 0.52], to: [0.42, 0.64] },
      focus: [0.5, 0.56],
      zoomFrom: 1,
      zoomTo: 1.18,
    },
    pill: "Ready · One-click approval",
  },
  {
    desktop: {
      cursor: { clickAt: 0.54, from: [0.62, 0.48], to: [0.858, 0.296] },
      focus: [0.78, 0.32],
      zoomFrom: 1,
      zoomTo: 1.24,
    },
    id: "review",
    mobile: {
      cursor: { clickAt: 0.54, from: [0.76, 0.56], to: [0.24, 0.66] },
      focus: [0.48, 0.58],
      zoomFrom: 1,
      zoomTo: 1.18,
    },
    pill: "Review · Answer once, unlock all",
  },
  {
    desktop: {
      cursor: { clickAt: 0.56, from: [0.48, 0.56], to: [0.88, 0.51] },
      focus: [0.84, 0.46],
      zoomFrom: 1,
      zoomTo: 1.2,
    },
    id: "tracker",
    mobile: {
      cursor: { clickAt: 0.56, from: [0.78, 0.52], to: [0.5, 0.54] },
      focus: [0.5, 0.5],
      zoomFrom: 1,
      zoomTo: 1.16,
    },
    pill: "Tracker · Every stage live",
  },
  {
    desktop: {
      cursor: { clickAt: 0.54, from: [0.68, 0.38], to: [0.93, 0.155] },
      focus: [0.78, 0.36],
      zoomFrom: 1,
      zoomTo: 1.2,
    },
    id: "resume",
    mobile: {
      cursor: { clickAt: 0.54, from: [0.76, 0.6], to: [0.34, 0.8] },
      focus: [0.5, 0.54],
      zoomFrom: 1,
      zoomTo: 1.16,
    },
    pill: "Resume · Tailored cover letters",
  },
  {
    desktop: {
      cursor: { clickAt: 0.54, from: [0.58, 0.54], to: [0.35, 0.49] },
      focus: [0.48, 0.46],
      zoomFrom: 1,
      zoomTo: 1.22,
    },
    id: "inbox",
    mobile: {
      cursor: { clickAt: 0.54, from: [0.8, 0.52], to: [0.5, 0.54] },
      focus: [0.5, 0.48],
      zoomFrom: 1,
      zoomTo: 1.16,
    },
    pill: "Inbox · Replies beside roles",
  },
  {
    desktop: {
      cursor: { clickAt: 0.54, from: [0.64, 0.46], to: [0.82, 0.34] },
      focus: [0.78, 0.38],
      zoomFrom: 1,
      zoomTo: 1.22,
    },
    id: "calendar",
    mobile: {
      cursor: { clickAt: 0.54, from: [0.74, 0.48], to: [0.28, 0.56] },
      focus: [0.5, 0.5],
      zoomFrom: 1,
      zoomTo: 1.16,
    },
    pill: "Calendar · Interviews synced",
  },
];

/** 820 frames (~27.3s at 30 fps): punchy product launch pacing with a clean Home loop closer. */
export const SEGMENTS: readonly Segment[] = [
  { chapter: "home", durationInFrames: 115, fadeIn: false, fadeOut: true, from: 0 },
  { chapter: "ready", durationInFrames: 120, fadeIn: true, fadeOut: true, from: 103 },
  { chapter: "review", durationInFrames: 115, fadeIn: true, fadeOut: true, from: 211 },
  { chapter: "tracker", durationInFrames: 115, fadeIn: true, fadeOut: true, from: 314 },
  { chapter: "resume", durationInFrames: 115, fadeIn: true, fadeOut: true, from: 417 },
  { chapter: "inbox", durationInFrames: 110, fadeIn: true, fadeOut: true, from: 520 },
  { chapter: "calendar", durationInFrames: 115, fadeIn: true, fadeOut: true, from: 618 },
  { chapter: "home", durationInFrames: 99, fadeIn: true, fadeOut: false, from: 721 },
];

export const TOTAL_FRAMES = 820;

export const CHAPTER_ORDER: readonly ChapterId[] = [
  "home",
  "ready",
  "review",
  "tracker",
  "resume",
  "inbox",
  "calendar",
];

/**
 * Resolve a chapter by id; the data is authored, so a miss is a programming error.
 * @param id The chapter id.
 * @returns The chapter definition.
 */
export function chapterFor(id: ChapterId) {
  const chapter = CHAPTERS.find((candidate) => candidate.id === id);

  if (chapter === undefined) {
    throw new Error(`Unknown demo chapter: ${id}`);
  }

  return chapter;
}

/**
 * The active segment and chapter at a given composition frame.
 * @param frame The composition frame.
 * @returns The active segment and chapter.
 */
export function activeSegmentAtFrame(frame: number) {
  let [current] = SEGMENTS;

  for (const segment of SEGMENTS) {
    if (frame >= segment.from) {
      current = segment;
    }
  }

  if (current === undefined) {
    throw new Error("Missing segments in demo video");
  }

  return {
    chapter: chapterFor(current.chapter),
    segment: current,
  };
}
