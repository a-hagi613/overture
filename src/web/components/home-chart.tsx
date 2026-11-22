import type { HomeRange, HomeRangeKey } from "../lib/home-api.ts";

import { copy } from "../../shared/copy.ts";

function subtitleFor(rangeKey: HomeRangeKey) {
  if (rangeKey === "30D") {
    return copy.home.chart.perDay30;
  }

  if (rangeKey === "90D") {
    return copy.home.chart.perWeek90;
  }

  return copy.home.chart.perDay7;
}

export function HomeChart(props: { range: HomeRange; rangeKey: HomeRangeKey }) {
  const { range, rangeKey } = props;
  const counts = range.chart.points.map((point) => point.count);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const max = Math.max(0, ...counts);
  const top = Math.ceil((max + 1) / 4) * 4;
  const count = counts.length;

  const points = counts.map((value, index) => {
    const x = count <= 1 ? 0 : (index / (count - 1)) * 1000;
    const y = 200 - (value / top) * 200;

    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const lastPoint = points.at(-1);
  const lastY = lastPoint === undefined ? 200 : lastPoint[1];
  const lastTop = `${((lastY / 200) * 100).toFixed(1)}%`;
  const lastCount = counts.at(-1) ?? 0;

  const lastLabel =
    range.chart.per === "week"
      ? copy.home.chart.thisWeek(lastCount)
      : copy.home.chart.today(lastCount);

  const subtitle = subtitleFor(rangeKey);
  const level = top / 4;

  return (
    <section
      aria-labelledby="home-chart"
      className="min-w-0 flex-[999_1_480px] rounded-lg border border-border bg-card px-4 pb-[18px] pt-[22px] shadow-sh min-[768px]:px-6"
    >
      <div>
        <h2 className="font-serif text-[26px] leading-[1.5]" id="home-chart">
          {copy.home.chart.title}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="mt-4 flex gap-2.5">
        <div className="home-chart-frame flex w-[26px] flex-none flex-col items-end justify-between text-[11.5px] tabular-nums text-muted-foreground">
          <span>{top}</span>
          <span>{level * 3}</span>
          <span>{level * 2}</span>
          <span>{level}</span>
          <span>{String(0)}</span>
        </div>
        <div className="home-chart-frame relative min-w-0 flex-1">
          <svg
            aria-label={copy.home.chart.aria(subtitle, total)}
            className="home-chart-frame block w-full overflow-visible"
            preserveAspectRatio="none"
            role="img"
            viewBox="0 0 1000 200"
          >
            {[0, 50, 100, 150].map((y) => (
              <line
                className="stroke-border"
                key={y}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                x1="0"
                x2="1000"
                y1={y}
                y2={y}
              />
            ))}
            <line
              className="stroke-input"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2="1000"
              y1="200"
              y2="200"
            />
            <path className="fill-signal-soft" d={`${line} L1000 200 L0 200 Z`} stroke="none" />
            <path
              className="stroke-signal"
              d={line}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div
            className="absolute right-0 h-[11px] w-[11px] translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-signal bg-card"
            style={{ top: lastTop }}
          />
          <div
            className="absolute right-3.5 -translate-y-[190%] whitespace-nowrap rounded-[5px] bg-foreground px-[9px] py-[3px] text-[12px] font-semibold text-background tabular-nums"
            style={{ top: lastTop }}
          >
            {lastLabel}
          </div>
        </div>
      </div>
      <div className="ml-9 mt-2 flex justify-between text-[11.5px] tabular-nums text-muted-foreground">
        {range.chart.labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}
