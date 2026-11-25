export type ChapterId = "home" | "tracker" | "resume" | "inbox";

export interface Chapter {
  id: ChapterId;
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
  { id: "home", pill: "Home · 90-day momentum" },
  { id: "tracker", pill: "Tracker · Move stages" },
  { id: "resume", pill: "Resume · Upload & scan" },
  { id: "inbox", pill: "Inbox · Employer replies" },
];

/** 600 frames (20.0s at 30 fps): four zero-zoom product scenes ending on a clean crossfade back to Home. */
export const SEGMENTS: readonly Segment[] = [
  { chapter: "home", durationInFrames: 100, fadeIn: false, fadeOut: true, from: 0 },
  { chapter: "tracker", durationInFrames: 185, fadeIn: true, fadeOut: true, from: 90 },
  { chapter: "resume", durationInFrames: 185, fadeIn: true, fadeOut: true, from: 265 },
  { chapter: "inbox", durationInFrames: 160, fadeIn: true, fadeOut: true, from: 440 },
];

export const TOTAL_FRAMES = 600;

export const CHAPTER_ORDER: readonly ChapterId[] = ["home", "tracker", "resume", "inbox"];

/**
 * Resolve a chapter by id.
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
