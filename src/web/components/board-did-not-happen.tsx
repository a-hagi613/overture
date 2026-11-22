import { copy } from "../../shared/copy.ts";
import type { DidNotHappenKey } from "../../shared/dossier.ts";
import { BoardMark } from "./board-mark.tsx";

export function BoardDidNotHappen({ keys }: { keys: DidNotHappenKey[] }) {
  if (keys.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="dossier-did-not" className="mt-6 border-t border-border pt-5">
      <h3 className="serif text-[22px] leading-[1.15]" id="dossier-did-not">
        {copy.board.dossier.didNotTitle}
      </h3>
      <ul aria-label={copy.board.dossier.didNotTitle} className="mt-3 list-none">
        {keys.map((key) => (
          <li className="flex gap-3 py-2.5 first:pt-0 last:pb-0" key={key}>
            <BoardMark kind="cross" />
            <div>
              <p className="text-[13.5px] font-semibold text-foreground">
                {copy.board.dossier.didNotLines[key].title}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {copy.board.dossier.didNotLines[key].body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
