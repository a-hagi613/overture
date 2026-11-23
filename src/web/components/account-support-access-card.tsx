import { copy } from "../../shared/copy.ts";
import { useSupportAccess } from "../lib/support-access-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "./ui/ds.ts";

const page = copy.settingsAccount.supportAccessPage;

type RevealAction = keyof typeof page.actions;

function isRevealAction(action: string): action is RevealAction {
  return Object.hasOwn(page.actions, action);
}

function actionLabel(action: string) {
  return isRevealAction(action) ? page.actions[action] : action;
}

function stamp(at: number) {
  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(at));
}

export function AccountSupportAccessCard() {
  const entries = useSupportAccess();

  return (
    <div id="support-access">
      <Card ariaLabelledBy="support-access-heading" className="p-5 md:p-6">
        <h2 className={dsCardTitle} id="support-access-heading">
          {copy.settingsAccount.supportAccessRow}
        </h2>
        <p className={`${dsBody} mt-1`}>{page.intro}</p>

        {entries.isError ? (
          <div className="mt-4" role="alert">
            <p className="text-sm font-semibold text-foreground">{page.errorTitle}</p>
            <p className={`${dsBody} mt-1`}>{page.errorBody}</p>
            <Button
              className="mt-3"
              onClick={() => {
                void entries.refetch();
              }}
              size="sm"
              variant="outline"
            >
              {page.retry}
            </Button>
          </div>
        ) : null}

        {entries.data !== undefined && entries.data.length === 0 ? (
          <div className="mt-4 border-t border-border pt-4" data-testid="support-access-empty">
            <p className="text-sm font-semibold text-foreground">{page.emptyTitle}</p>
            <p className={`${dsBody} mt-1`}>{page.emptyBody}</p>
          </div>
        ) : null}

        {entries.data !== undefined && entries.data.length > 0 ? (
          <ol className="mt-4" data-testid="support-access-list">
            {entries.data.map((entry) => (
              <li
                className="border-t border-border py-3.5"
                data-action={entry.action}
                key={entry.id}
              >
                <p className={dsMono}>
                  <time dateTime={new Date(entry.at).toISOString()}>{stamp(entry.at)}</time>
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {actionLabel(entry.action)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-foreground">
                  <span className="text-muted-foreground">{`${page.reason}: `}</span>
                  {entry.reason}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </Card>
    </div>
  );
}
