type GlyphName =
  | "back"
  | "copy"
  | "bell"
  | "board"
  | "check"
  | "chevron"
  | "copy"
  | "dash"
  | "forward"
  | "home"
  | "inbox"
  | "lock"
  | "mail"
  | "profile"
  | "rail"
  | "ready"
  | "review"
  | "search"
  | "signout"
  | "sun"
  | "doc"
  | "moon"
  | "send"
  | "hash"
  | "pause"
  | "clock"
  | "users"
  | "tag"
  | "link"
  | "grid";

interface GlyphPaths {
  readonly paths: string[];
  readonly strokeWidth: number;
}

const glyphs: Record<GlyphName, GlyphPaths> = {
  back: { paths: ["M19 12H5", "M11 6l-6 6 6 6"], strokeWidth: 1.8 },
  copy: {
    paths: [
      "M11 9h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2v-7a2 2 0 012-2z",
      "M5 15V6a1 1 0 011-1h9",
    ],
    strokeWidth: 1.7,
  },
  bell: {
    paths: ["M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z", "M10 20a2 2 0 004 0"],
    strokeWidth: 1.6,
  },
  home: { paths: ["M4 11l8-7 8 7", "M6 10v10h12V10"], strokeWidth: 1.6 },
  board: {
    paths: [
      "M4 4h3a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z",
      "M11 4h3a1 1 0 011 1v8a1 1 0 01-1 1h-3a1 1 0 01-1-1V5a1 1 0 011-1z",
      "M18 4h2a1 1 0 011 1v11a1 1 0 01-1 1h-2a1 1 0 01-1-1V5a1 1 0 011-1z",
    ],
    strokeWidth: 1.6,
  },
  check: { paths: ["M5 12.5l4.5 4.5L19 7.5"], strokeWidth: 2 },
  chevron: { paths: ["M6 9l6 6 6-6"], strokeWidth: 1.8 },
  copy: {
    paths: [
      "M9 9h9a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2v-9a2 2 0 012-2z",
      "M5 15V6a2 2 0 012-2h9",
    ],
    strokeWidth: 1.8,
  },
  forward: { paths: ["M5 12h14", "M13 6l6 6-6 6"], strokeWidth: 1.8 },
  signout: {
    paths: ["M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4", "M16 8l4 4-4 4", "M20 12H9"],
    strokeWidth: 1.7,
  },
  dash: { paths: ["M5 12h14"], strokeWidth: 1.8 },
  ready: { paths: ["M3 11l18-8-8 18-2-8-8-2z"], strokeWidth: 1.6 },
  review: {
    paths: [
      "M12 3a9 9 0 100 18 9 9 0 000-18z",
      "M9.5 9.5a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5",
      "M12 17h.01",
    ],
    strokeWidth: 1.6,
  },
  inbox: { paths: ["M3 13l3-8h12l3 8", "M3 13v6h18v-6h-5l-1 2h-6l-1-2z"], strokeWidth: 1.6 },
  profile: {
    paths: ["M12 4a4 4 0 100 8 4 4 0 000-8z", "M4 21c0-4 4-6 8-6s8 2 8 6"],
    strokeWidth: 1.6,
  },
  rail: {
    paths: [
      "M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
      "M9 4v16",
      "M16 10l-2 2 2 2",
    ],
    strokeWidth: 1.6,
  },
  moon: { paths: ["M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"], strokeWidth: 1.7 },
  search: {
    paths: ["M11 4.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z", "M16 16l4.5 4.5"],
    strokeWidth: 1.7,
  },
  doc: { paths: ["M5 4h10l4 4v12H5z", "M9 13h6M9 17h4"], strokeWidth: 1.7 },
  sun: {
    paths: [
      "M12 8a4 4 0 100 8 4 4 0 000-8z",
      "M12 2v2",
      "M12 20v2",
      "M4.9 4.9l1.4 1.4",
      "M17.7 17.7l1.4 1.4",
      "M2 12h2",
      "M20 12h2",
      "M4.9 19.1l1.4-1.4",
      "M17.7 6.3l1.4-1.4",
    ],
    strokeWidth: 1.7,
  },
  lock: {
    paths: [
      "M5 13a2 2 0 012-2h10a2 2 0 012 2v5a2 2 0 01-2 2H7a2 2 0 01-2-2z",
      "M8 11V8a4 4 0 018 0v3",
    ],
    strokeWidth: 1.8,
  },
  mail: {
    paths: ["M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z", "M3 7l9 6 9-6"],
    strokeWidth: 1.8,
  },
  send: { paths: ["m22 2-7 20-4-9-9-4z", "M22 2 11 13"], strokeWidth: 1.6 },
  hash: { paths: ["M10 3 8 21", "M16 3l-2 18", "M4 9h17", "M3 15h17"], strokeWidth: 1.6 },
  pause: { paths: ["M9 5v14", "M15 5v14"], strokeWidth: 2.2 },
  clock: {
    paths: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M12 7v5l3 2"],
    strokeWidth: 1.6,
  },
  users: {
    paths: [
      "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
      "M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5",
      "M16.5 4.6a3 3 0 010 5.8",
      "M18 14.7c2.1.6 3.5 2.2 3.5 4.8",
    ],
    strokeWidth: 1.6,
  },
  tag: {
    paths: [
      "M3 5a2 2 0 012-2h6.2a2 2 0 011.4.6l7.8 7.8a2 2 0 010 2.8l-6.2 6.2a2 2 0 01-2.8 0L3.6 12.6A2 2 0 013 11.2z",
      "M8 8h.01",
    ],
    strokeWidth: 1.6,
  },
  link: {
    paths: [
      "M10 13.5a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7l-1.5 1.5",
      "M14 10.5a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1.5-1.5",
    ],
    strokeWidth: 1.7,
  },
  grid: {
    paths: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
    strokeWidth: 1.6,
  },
};

export function NavGlyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  const glyph = glyphs[name];

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      strokeLinecap="round"
      strokeLinejoin="round"
      stroke="currentColor"
      strokeWidth={glyph.strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {glyph.paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
