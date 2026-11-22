import { PUBLIC_ATS } from "../../shared/plans.ts";
import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const { landing: copy } = marketingCopy;

const tilePositions: Record<(typeof PUBLIC_ATS)[number], { left: number; top: number }> = {
  Ashby: { left: 820, top: 16 },
  Greenhouse: { left: 40, top: 16 },
  Lever: { left: 430, top: 16 },
  Personio: { left: 235, top: 524 },
  Workable: { left: 625, top: 524 },
};

const hub = { height: 160, left: 460, top: 240, width: 240 };
const tileWidth = 300;
const tileHeight = 100;

function hubEdgeToward(x: number, y: number) {
  const centerX = hub.left + hub.width / 2;
  const centerY = hub.top + hub.height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : hub.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : hub.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

const connectors = PUBLIC_ATS.map((ats) => {
  const tile = tilePositions[ats];
  const anchorX = tile.left + tileWidth / 2;
  const anchorY = tile.top < hub.top ? tile.top + tileHeight : tile.top;
  const start = hubEdgeToward(anchorX, anchorY);

  return { anchorX, anchorY, x: start.x, y: start.y };
});

function unit(value: number) {
  return `calc(var(--u) * ${String(value)})`;
}

function tileOffset(ats: (typeof PUBLIC_ATS)[number]) {
  const position = tilePositions[ats];

  return {
    height: unit(tileHeight),
    left: unit(position.left),
    top: unit(position.top),
    width: unit(tileWidth),
  };
}

function hubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <rect className="hub-ground" height="32" rx="7" width="32" />
      <circle className="hub-ring" cx="16" cy="16" fill="none" r="8.5" strokeWidth="1.5" />
      <path className="hub-tick" d="M16 5.5v21" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function submittedTag() {
  return (
    <span className="tg2">
      <NavGlyph name="check" size={14} />
      {copy.atsSubmittedTag}
    </span>
  );
}

function desktopStage() {
  return (
    <div className="stagebox">
      <ul aria-label={copy.atsStageLabel} className="stage">
        <li
          aria-hidden="true"
          className="hub"
          style={{
            height: unit(hub.height),
            left: unit(hub.left),
            top: unit(hub.top),
            width: unit(hub.width),
          }}
        >
          {hubMark()}
          <span className="serif hub-name">{marketingCopy.brand}</span>
        </li>
        {PUBLIC_ATS.map((ats) => (
          <li className="tile" key={ats} style={tileOffset(ats)}>
            <span className="lgt">{ats}</span>
            {submittedTag()}
          </li>
        ))}
      </ul>
      <svg aria-hidden="true" className="stage-lines" viewBox="0 0 1160 640">
        {connectors.map((line) => (
          <line
            className="ln"
            key={`${String(line.x)}-${String(line.y)}`}
            x1={line.x}
            x2={line.anchorX}
            y1={line.y}
            y2={line.anchorY}
          />
        ))}
        {connectors.map((line, index) => (
          <circle
            className={`stage-dot stage-dot-${String(index + 1)}`}
            cx={line.x}
            cy={line.y}
            key={`dot-${String(line.x)}-${String(line.y)}`}
            r={11}
          />
        ))}
      </svg>
    </div>
  );
}

function mobileTile(ats: string, index: number) {
  const last = index === PUBLIC_ATS.length - 1;
  const side = index % 2 === 0 ? "l" : "r";
  const position = last ? "last" : side;

  return (
    <div className={`tm2 ${position}`} key={ats}>
      <span className="lgt">{ats}</span>
      {submittedTag()}
    </div>
  );
}

function mobileStage() {
  return (
    <div className="stage-m">
      <div className="sm">
        <div className="smhub">
          {hubMark()}
          <span className="serif">{marketingCopy.brand}</span>
        </div>
        <div className="smgrid">
          <span aria-hidden="true" className="spine" />
          <span aria-hidden="true" className="spd" />
          {PUBLIC_ATS.map((ats, index) => mobileTile(ats, index))}
        </div>
        <p className="sr-only">{copy.atsStageLabel}</p>
      </div>
    </div>
  );
}

export function MarketingLandingBand() {
  return (
    <section className="band" id="boards">
      <div className="wrap band-head">
        <p className="eyebrow band-eyebrow">{copy.atsEyebrow}</p>
        <div className="band-title-row">
          <h2 className="bh">
            {copy.atsTitle}
            <span className="it">{copy.atsTitleItalic}</span>
          </h2>
          <div className="band-note">
            <p>{copy.atsNote}</p>
            <p className="mono band-count">{copy.atsCount}</p>
          </div>
        </div>
      </div>

      <div className="wrap band-body">
        <div className="bandrow">
          <div>
            <p className="tl">
              <span className="dotn" />
              {copy.atsDirect}
            </p>
            <p className="tc">{copy.atsDirectNote}</p>
          </div>
          <div className="cntr">
            <span className="mono">{copy.atsSubmitted}</span>
            <span className="serif num cn">{copy.atsSubmittedCount}</span>
          </div>
        </div>
        {desktopStage()}
        {mobileStage()}
      </div>
    </section>
  );
}
