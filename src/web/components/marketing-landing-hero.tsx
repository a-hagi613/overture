import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { MarketingRing } from "./marketing-ring.tsx";

const { landing: copy } = marketingCopy;
const { hero } = copy;
const front = hero.card;
const behindLayers = ["d1", "d2"] as const;

function heroIntro() {
  return (
    <div className="hl">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1 className="serif hero-h1">{copy.headline}</h1>
      <p className="sub">{copy.lede}</p>
      <div className="hero-actions">
        <a className="btn hero-btn" href="/signin">
          {marketingCopy.cta.startTrial}
          <NavGlyph name="forward" size={16} />
        </a>
        <a className="btn2 hero-btn" href="#how">
          {marketingCopy.cta.seeSteps}
        </a>
      </div>
      <p className="hero-note mono">{copy.trialNote}</p>
    </div>
  );
}

function frontCard() {
  return (
    <article className="jc d0 act">
      <div className="jb">
        <div className="jh">
          <span className="mk l">{front.mark}</span>
          <div className="jh-main">
            <p className="serif jt">{front.role}</p>
            <p className="jm">{front.company}</p>
          </div>
          <MarketingRing score={front.score} size="m" />
        </div>
        <p className="mono jl">{front.meta}</p>
        <div className="evh">
          <span className="lbl">{hero.askLabel}</span>
          <span />
          <span className="lbl">{hero.factLabel}</span>
        </div>
        <div className="evs">
          {front.rows.map(([ask, fact]) => (
            <div className="ev" key={ask}>
              <span className="ask">{ask}</span>
              <span aria-hidden="true" className="evc" />
              <span className="fact">{fact}</span>
            </div>
          ))}
        </div>
        <div className="rcp">
          <div className="rci">
            <p className="rcp-line">
              <NavGlyph name="check" size={13} />
              <span>{hero.note}</span>
            </p>
            <div className="rcp-row">
              <span className="mono rcp-when">{hero.stampNote}</span>
              <span className="stamp">{hero.stamp}</span>
            </div>
            <div className="rcp-actions">
              <span className="btn mini">{hero.send}</span>
              <span className="btn2 mini">{hero.skip}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function stack() {
  return (
    <div className="stack">
      {behindLayers.map((layer) => (
        <div aria-hidden="true" className={`jc ${layer}`} key={layer} />
      ))}
      {frontCard()}
    </div>
  );
}

function rail() {
  const lastIndex = hero.railTicks.length - 1;

  return (
    <>
      <p className="sr-only">{hero.railLabel}</p>
      <div aria-hidden="true" className="rail">
        <div className="rline" />
        {hero.railTicks.map((tick, index) => (
          <span key={tick}>
            <span className="rt" style={{ left: `${String((index / lastIndex) * 100)}%` }} />
            <span className="rl mono" style={{ left: `${String((index / lastIndex) * 100)}%` }}>
              {tick}
            </span>
          </span>
        ))}
        <span className="rmk" style={{ left: hero.markerPos }}>
          <span className="rtime mono">{hero.markerTime}</span>
        </span>
      </div>
    </>
  );
}

function heroFigure() {
  return (
    <figure className="hv">
      <figcaption className="sr-only">{hero.groupLabel}</figcaption>
      {stack()}
      <output className="tally">
        <span className="ta">
          {hero.tally[0][0]} <b className="num">{hero.tally[0][1]}</b>
        </span>
        <span aria-hidden="true" className="tally-div" />
        <span>
          {hero.tally[1][0]} <b className="num">{hero.tally[1][1]}</b>
        </span>
      </output>
      {rail()}
    </figure>
  );
}

export function MarketingLandingHero() {
  return (
    <section className="wrap hero">
      <div className="hero-grid">
        {heroIntro()}
        <div className="hv-wrap">{heroFigure()}</div>
      </div>
    </section>
  );
}
