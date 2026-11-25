import { CursorGlyph } from "./cursor-glyph.tsx";

export function DragCursor({
  opacity,
  pressed,
  scale,
  x,
  y,
}: {
  opacity: number;
  pressed: number;
  scale: number;
  x: number;
  y: number;
}) {
  return (
    <span
      style={{
        left: `${String(x * 100)}%`,
        opacity,
        position: "absolute",
        top: `${String(y * 100)}%`,
        zIndex: 8,
      }}
    >
      <CursorGlyph pressed={pressed} scale={scale} />
    </span>
  );
}
