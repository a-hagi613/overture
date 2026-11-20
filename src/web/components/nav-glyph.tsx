type GlyphName =
  | "back"
  | "board"
  | "home"
  | "inbox"
  | "lock"
  | "mail"
  | "profile"
  | "rail"
  | "review"
  | "sun"
  | "moon";

interface GlyphPaths {
  readonly paths: string[];
  readonly strokeWidth: number;
}

const glyphs: Record<GlyphName, GlyphPaths> = {
  back: { paths: ["M19 12H5", "M11 6l-6 6 6 6"], strokeWidth: 1.8 },
  home: { paths: ["M4 11l8-7 8 7", "M6 10v10h12V10"], strokeWidth: 1.6 },
  board: {
    paths: [
      "M3 5a1 1 0 011-1h3a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1z",
      "M10 5a1 1 0 011-1h3a1 1 0 011 1v9a1 1 0 01-1 1h-3a1 1 0 01-1-1z",
      "M17 5a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1h-3a1 1 0 01-1-1z",
    ],
    strokeWidth: 1.6,
  },
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
