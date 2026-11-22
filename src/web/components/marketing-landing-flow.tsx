import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { MarketingRing } from "./marketing-ring.tsx";

const { landing: copy } = marketingCopy;
const { movements } = copy;

const pathSegments = [
  { cls: "fh pz1", left: "calc(0% + 24px)", top: "40px", width: "calc(58.3333% + 16.333px)" },
  {
    cls: "fh pz2",
    left: "calc(58.3333% + 40.333px)",
    top: "40px",
    width: "calc(41.6667% - 26.333px)",
  },
  { cls: "fv pz3", height: "488px", left: "calc(100% + 14px)", top: "40px" },
  {
    cls: "fh pz4",
    left: "calc(58.3333% + 40.333px)",
    top: "528px",
    width: "calc(41.6667% - 26.333px)",
  },
  { cls: "fh pz5", left: "calc(58.3333% + 2.333px)", top: "528px", width: "38px" },
  { cls: "fv pz6", height: "462px", left: "calc(58.3333% + 2.333px)", top: "528px" },
  { cls: "fh pz7", left: "-14px", top: "990px", width: "calc(58.3333% + 16.333px)" },
  { cls: "fv pz8", height: "26px", left: "-14px", top: "990px" },
  { cls: "fh pz9", left: "-14px", top: "1016px", width: "38px" },
  { cls: "fh pz10", left: "calc(0% + 24px)", top: "1016px", width: "calc(41.6667% + 11.667px)" },
  {
    cls: "fh pz11",
    left: "calc(41.6667% + 35.667px)",
    top: "1016px",
    width: "calc(58.3333% - 21.667px)",
  },
  { cls: "fv pz12", height: "484px", left: "calc(100% + 14px)", top: "1016px" },
  { cls: "fh pz13", left: "calc(0% + 24px)", top: "1500px", width: "calc(100% - 10px)" },
];

function tileHeading(roman: string, title: string) {
  return (
    <h3>
      {roman} <span className="it">{title}</span>
    </h3>
  );
}

function discoveryTile() {
  return (
    <>
      <div aria-hidden="true" className="vg">
        <div className="vg-col">
          <div className="pr-head">
            <span className="lbl">{movements.discovery.label}</span>
            <span className="mono pr-check">
              <NavGlyph name="clock" size={15} />
              {movements.discovery.nextCheck}
            </span>
          </div>
          {movements.discovery.postings.map((posting, index) => (
            <div className={index === 3 ? "pr old" : "pr"} key={posting.company}>
              <span className="mk m">{posting.mark}</span>
              <div className="pr-main">
                <p className="serif prt">{posting.role}</p>
                <p className="prm">{posting.company}</p>
              </div>
              {index < 3 ? <span className="dotn" /> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="bt">
        {tileHeading(movements.discovery.roman, movements.discovery.title)}
        <p className="bp">{movements.discovery.body}</p>
      </div>
    </>
  );
}

function screeningTile() {
  return (
    <>
      <div aria-hidden="true" className="vg">
        <div className="kc score-card">
          <div className="score-head">
            <MarketingRing score={movements.screening.score} size="l" />
            <div className="score-main">
              <p className="serif prt">{movements.screening.role}</p>
              <p className="prm">{movements.screening.company}</p>
            </div>
          </div>
          <ul className="why">
            {movements.screening.why.map((reason) => (
              <li key={reason}>
                <NavGlyph name="check" size={14} />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="bt">
        {tileHeading(movements.screening.roman, movements.screening.title)}
        <p className="bp">{movements.screening.body}</p>
      </div>
    </>
  );
}

function preparationTile() {
  return (
    <>
      <div aria-hidden="true" className="vg">
        <div className="vg-col tight">
          {movements.preparation.answers.map((answer, index) => (
            <div className="kc qa" key={answer.question}>
              <p className="qq">{answer.question}</p>
              <div className="qr">
                <span className="serif">{answer.answer}</span>
                <span className={index === 1 ? "src sv" : "src"}>
                  <NavGlyph name={index === 1 ? "tag" : "doc"} size={12} />
                  {answer.source}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="bt">
        {tileHeading(movements.preparation.roman, movements.preparation.title)}
        <p className="bp">{movements.preparation.body}</p>
      </div>
    </>
  );
}

function reviewTile() {
  return (
    <>
      <div aria-hidden="true" className="vg">
        <div className="kc review-card">
          <span className="pill need">{movements.review.pill}</span>
          <p className="serif review-q">{movements.review.question}</p>
          <div className="review-foot">
            <b className="num">{movements.review.unblocks}</b>
            <span className="btn mini">{movements.review.action}</span>
          </div>
        </div>
      </div>
      <div className="bt">
        {tileHeading(movements.review.roman, movements.review.title)}
        <p className="bp">{movements.review.body}</p>
      </div>
    </>
  );
}

function overtureTile() {
  return (
    <>
      <div aria-hidden="true" className="vg">
        <div className="vg-col tight">
          <div className="kc letter-card">
            <p className="serif letter">
              {movements.overture.greeting}
              <span className="hlc">{movements.overture.company}</span>
              {movements.overture.greetingSuffix}
            </p>
            <p className="serif letter letter-muted">{movements.overture.letter}</p>
          </div>
          <span className="src">
            <NavGlyph name="doc" size={13} />
            {movements.overture.resume}
          </span>
        </div>
      </div>
      <div className="bt">
        {tileHeading(movements.overture.roman, movements.overture.title)}
        <p className="bp">{movements.overture.body}</p>
      </div>
    </>
  );
}

function comebackTile() {
  return (
    <>
      <div className="bt comeback-copy">
        {tileHeading(movements.comeback.roman, movements.comeback.title)}
        <p className="bp">{movements.comeback.body}</p>
      </div>
      <div aria-hidden="true" className="vg comeback">
        <div className="kb">
          <div className="kcols">
            {movements.comeback.columns.map((column) => (
              <div className="kcol" key={column.title}>
                <div className="kh">
                  <span className="serif">{column.title}</span>
                  <span className="cpill num">{column.count}</span>
                </div>
                {column.cards.map((card) => (
                  <div className="kcard" key={card.name}>
                    <span className="kn">{card.name}</span>
                    <span className="kr serif">{card.role}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only">{movements.comeback.boardLabel}</p>
    </>
  );
}

const tiles = [
  { body: discoveryTile(), cls: "c1", number: movements.discovery.number },
  { body: screeningTile(), cls: "c2", number: movements.screening.number },
  { body: preparationTile(), cls: "c3", number: movements.preparation.number },
  { body: reviewTile(), cls: "c4", number: movements.review.number },
  { body: overtureTile(), cls: "c5", number: movements.overture.number },
  { body: comebackTile(), cls: "c6", number: movements.comeback.number },
];

function flowGrid() {
  return (
    <div className="fgrid">
      {tiles.map((tile) => (
        <div className={`fc ${tile.cls}`} key={tile.cls}>
          <span className={`nd n${tile.number}`}>{tile.number}</span>
          {tile.cls === "c6" ? null : (
            <div className={`fl vl vk${tile.number}`}>
              <span className="fdot" />
            </div>
          )}
          <article className={tile.cls === "c6" ? "bc row" : "bc"}>{tile.body}</article>
        </div>
      ))}
    </div>
  );
}

export function MarketingLandingFlow() {
  return (
    <section className="wrap landing-how" id="how">
      <div className="section-head">
        <h2 className="t display">
          {copy.howTitleLead} <span className="it">{copy.howTitleItalic}</span>
        </h2>
        <p className="section-lede">{copy.howLede}</p>
      </div>

      <div className="flow">
        <div className="gridwrap go">
          {flowGrid()}
          <div aria-hidden="true" className="path">
            {pathSegments.map(({ cls, ...position }) => (
              <div className={`fl ${cls}`} key={cls} style={position}>
                <span className="fdot" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
