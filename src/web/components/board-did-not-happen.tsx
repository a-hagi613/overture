import { ShieldCheck } from "lucide-react";

import { copy } from "../../shared/copy.ts";
import type { DidNotHappenKey } from "../../shared/dossier.ts";
import { dsCardTitle } from "./ui/ds.ts";

export function BoardDidNotHappen({ keys }: { keys: DidNotHappenKey[] }) {
  if (keys.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="dossier-did-not" className="border-t border-border pt-5">
      <h3 className={dsCardTitle} id="dossier-did-not">
        {copy.board.dossier.didNotTitle}
      </h3>
      <ul aria-label={copy.board.dossier.didNotTitle} className="mt-3 list-none space-y-3">
        {keys.map((key) => (
          <li className="flex items-start gap-3" key={key}>
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-signal-text"
              size={18}
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {copy.board.dossier.didNotLines[key].title}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {copy.board.dossier.didNotLines[key].body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
