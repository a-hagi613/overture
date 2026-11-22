export function MarketingRing({ score, size }: { score: number; size: "m" | "l" }) {
  const radius = size === "l" ? 42 : 24;
  const box = size === "l" ? 96 : 56;
  const center = box / 2;
  const length = 2 * Math.PI * radius;

  return (
    <span className={size === "l" ? "score-ring big" : "score-ring"}>
      <svg
        aria-label={`Match ${String(score)}`}
        role="img"
        viewBox={`0 0 ${String(box)} ${String(box)}`}
      >
        <circle
          className="ring-track"
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          strokeWidth={size === "l" ? 3 : 2.5}
        />
        <circle
          className="ring-arc"
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          strokeDasharray={`${String((length * score) / 100)} ${String(length)}`}
          strokeLinecap="round"
          strokeWidth={size === "l" ? 3 : 2.5}
          transform={`rotate(-90 ${String(center)} ${String(center)})`}
        />
      </svg>
      <span aria-hidden="true" className="serif it num">
        {String(score)}
      </span>
    </span>
  );
}
