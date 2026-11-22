import { marketingCopy } from "../../shared/marketing-copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const { landing: copy } = marketingCopy;
const { replies } = copy;

function boardMock() {
  return (
    <>
      <div aria-hidden="true" className="rb">
        {replies.columns.map((column, index) => (
          <div className={`rcolh rc${String(index)}`} key={column}>
            <span className="serif">{column}</span>
          </div>
        ))}
        {replies.cards.map((card) => (
          <div
            className={`rcd col${String(card.column)}${"hot" in card ? " hotc" : ""}${"muted" in card ? " mut" : ""}`}
            key={`${card.name}-${card.top}`}
            style={{ top: card.top }}
          >
            <span className="kn">{card.name}</span>
            <span className="kr serif">{card.role}</span>
            {"tag" in card ? <span className="rtag">{card.tag}</span> : null}
          </div>
        ))}
      </div>
      <p className="sr-only">{replies.boardLabel}</p>
    </>
  );
}

function emailCard(email: (typeof replies.emails)[number]) {
  return (
    <article className="em" key={email.from}>
      <div className="em-head">
        <span className="mk m round">{email.mark}</span>
        <div className="em-from">
          <p className="em-who">{email.from}</p>
          <p className="mono em-time">{email.time}</p>
        </div>
      </div>
      <p className="emsub">{email.subject}</p>
      <p className="emsn">{email.preview}</p>
      <span className="lbp">
        <NavGlyph name="mail" size={14} />
        {email.label}
      </span>
    </article>
  );
}

export function MarketingLandingReplies() {
  return (
    <section className="wrap rsec" id="replies">
      <div className="section-head between">
        <h2 className="t display">
          {copy.repliesTitleLead} <span className="it">{copy.repliesTitleItalic}</span>
        </h2>
        <p className="section-lede">{copy.repliesLede}</p>
      </div>

      <div className="rgrid">
        <div className="inbox">
          <div className="ibh">
            <span className="lbl ibh-label">
              <NavGlyph name="mail" size={13} />
              {replies.inboxLabel}
            </span>
            <span className="mono read-only">{replies.readOnly}</span>
          </div>
          <div className="mails">{replies.emails.map((email) => emailCard(email))}</div>
        </div>

        <div aria-hidden="true" className="rarrow">
          <NavGlyph name="forward" size={28} />
        </div>

        <div className="rbwrap card">
          {boardMock()}
          <p className="rnote">{replies.note}</p>
        </div>
      </div>

      <p className="trust">
        <NavGlyph name="lock" size={15} />
        {replies.trust}
      </p>
    </section>
  );
}
