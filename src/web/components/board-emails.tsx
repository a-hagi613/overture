import { copy } from "../../shared/copy.ts";
import type { ApplicationDetail } from "../lib/board-api.ts";
import { stamp } from "../lib/board-format.ts";

export function BoardEmails({ detail }: { detail: ApplicationDetail }) {
  if (detail.mail.length === 0) {
    return (
      <p className="pt-[18px] text-[13px] text-muted-foreground md:pt-[22px]">
        {copy.board.emails.empty}
      </p>
    );
  }

  return (
    <div aria-label={copy.board.tabs.emails} className="pt-[18px] md:pt-[22px]" role="tabpanel">
      {detail.mail.map((thread) => (
        <section className="mb-5" key={thread.id}>
          <h3 className="serif text-[20px] leading-[1.2]">{thread.subject}</h3>
          <ul className="mt-2 list-none">
            {thread.messages.map((message) => (
              <li className="border-t border-border py-2.5" key={message.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12.5px] font-semibold">{message.from}</p>
                  <span className="mono flex-none text-[11px] text-muted-foreground">
                    {stamp(message.at, detail.timeZone)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{message.snippet}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
