export type ChapterId = "board" | "home" | "inbox" | "ready" | "review";

export interface CursorBeat {
  /** Where the pointer enters, in screenshot-relative coordinates. */
  from: readonly [number, number];
  /** Where the pointer lands and clicks. */
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
  body: string;
  desktop: ChapterView;
  id: ChapterId;
  mobile: ChapterView;
  pill: string;
  titleItalic: string;
  titlePlain: string;
  url: string;
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
    body: "Home, Board, Ready, Review and Inbox sit on one desk, with the next send time always in view.",
    desktop: {
      cursor: null,
      focus: [0.42, 0.4],
      zoomFrom: 1,
      zoomTo: 1,
    },
    id: "home",
    mobile: {
      cursor: null,
      focus: [0.5, 0.42],
      zoomFrom: 1,
      zoomTo: 1,
    },
    pill: "Demo workspace",
    titleItalic: "one place.",
    titlePlain: "Every application in ",
    url: "tryoverture.com/home",
  },
  {
    body: "Overture fills each form and holds it until you say send. Nothing goes out on its own.",
    desktop: {
      cursor: { clickAt: 0.58, from: [0.9, 0.62], to: [0.823, 0.232] },
      focus: [0.74, 0.34],
      zoomFrom: 1,
      zoomTo: 1,
    },
    id: "ready",
    mobile: {
      cursor: { clickAt: 0.58, from: [0.82, 0.54], to: [0.5, 0.355] },
      focus: [0.5, 0.36],
      zoomFrom: 1,
      zoomTo: 1,
    },
    pill: "Auto-prepared queue",
    titleItalic: "approved.",
    titlePlain: "Prepared, then ",
    url: "tryoverture.com/ready",
  },
  {
    body: "One answer unblocks every application that asks for it, and Overture reuses it from then on.",
    desktop: {
      cursor: { clickAt: 0.6, from: [0.9, 0.74], to: [0.634, 0.865] },
      focus: [0.68, 0.62],
      zoomFrom: 1,
      zoomTo: 1,
    },
    id: "review",
    mobile: {
      cursor: { clickAt: 0.6, from: [0.82, 0.62], to: [0.5, 0.78] },
      focus: [0.5, 0.68],
      zoomFrom: 1,
      zoomTo: 1,
    },
    pill: "Answer once, reuse forever",
    titleItalic: "every application.",
    titlePlain: "One answer unblocks ",
    url: "tryoverture.com/review",
  },
  {
    body: "Queued, ready, applied, interviews and closed: every application carries its stage in one board.",
    desktop: {
      cursor: { clickAt: 0.62, from: [0.3, 0.46], to: [0.548, 0.91] },
      focus: [0.58, 0.6],
      zoomFrom: 1,
      zoomTo: 1,
    },
    id: "board",
    mobile: {
      cursor: { clickAt: 0.62, from: [0.74, 0.4], to: [0.6, 0.616] },
      focus: [0.55, 0.62],
      zoomFrom: 1,
      zoomTo: 1,
    },
    pill: "Kanban pipeline",
    titleItalic: "offer.",
    titlePlain: "From queued to ",
    url: "tryoverture.com/applications",
  },
  {
    body: "Confirmations, screening calls and offers land beside the application that earned them.",
    desktop: {
      cursor: { clickAt: 0.55, from: [0.82, 0.66], to: [0.36, 0.36] },
      focus: [0.42, 0.5],
      zoomFrom: 1,
      zoomTo: 1,
    },
    id: "inbox",
    mobile: {
      cursor: { clickAt: 0.55, from: [0.82, 0.56], to: [0.5, 0.42] },
      focus: [0.5, 0.5],
      zoomFrom: 1,
      zoomTo: 1,
    },
    pill: "Employer inbox",
    titleItalic: "your workspace.",
    titlePlain: "Replies land in ",
    url: "tryoverture.com/inbox",
  },
];

/** 600 frames at 30 fps: four chapters, a home intro, and a home outro that loops back to frame zero. */
export const SEGMENTS: readonly Segment[] = [
  { chapter: "home", durationInFrames: 150, fadeIn: false, fadeOut: true, from: 0 },
  { chapter: "ready", durationInFrames: 210, fadeIn: true, fadeOut: true, from: 130 },
  { chapter: "review", durationInFrames: 210, fadeIn: true, fadeOut: true, from: 320 },
  { chapter: "board", durationInFrames: 210, fadeIn: true, fadeOut: true, from: 510 },
  { chapter: "inbox", durationInFrames: 140, fadeIn: true, fadeOut: true, from: 700 },
  { chapter: "home", durationInFrames: 80, fadeIn: true, fadeOut: false, from: 820 },
];

export const TOTAL_FRAMES = 900;

export const CHAPTER_ORDER: readonly ChapterId[] = ["ready", "review", "board", "inbox"];

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
 * The chapter a frame belongs to, preferring the newest segment that has started.
 * @param frame The composition frame.
 * @returns The active chapter definition.
 */
export function chapterAtFrame(frame: number) {
  let active = chapterFor("home");

  for (const segment of SEGMENTS) {
    if (frame >= segment.from) {
      active = chapterFor(segment.chapter);
    }
  }

  return active;
}
