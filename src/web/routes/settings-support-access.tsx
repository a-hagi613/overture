import { copy } from "../../shared/copy.ts";
import { SettingsAccountTabs } from "../components/settings-account-tabs.tsx";
import { SettingsHeader } from "../components/settings-header.tsx";
import { useSupportAccess } from "../lib/support-access-api.ts";

const page = copy.settingsAccount.supportAccessPage;

type RevealAction = keyof typeof page.actions;

function isRevealAction(action: string): action is RevealAction {
  return Object.hasOwn(page.actions, action);
}

function actionLabel(action: string) {
  return isRevealAction(action) ? page.actions[action] : action;
}

function stamp(at: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(at));
}

export function SettingsSupportAccessPage() {
  const entries = useSupportAccess();

  return (
    <div className="mx-auto max-w-[760px]" data-testid="settings-support-access">
      <SettingsHeader
        eyebrow={page.eyebrow}
        lead={page.lead}
        titleNode={
          <>
            {page.titlePlain} <span className="italic">{page.titleItalic}</span>
          </>
        }
      />
      <SettingsAccountTabs active="supportAccess" />
      <section
        aria-labelledby="support-access-heading"
        className="mt-7 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      >
        <h2 className="font-serif text-[26px] leading-[1.1]" id="support-access-heading">
          {page.headingPlain} <span className="italic">{page.headingItalic}</span>
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{page.intro}</p>
        {entries.isError ? (
          <div className="mt-4" role="alert">
            <p className="text-sm font-semibold">{page.errorTitle}</p>
            <p className="text-[12.5px] text-muted-foreground">{page.errorBody}</p>
            <button
              className="mt-3 inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted"
              onClick={() => {
                void entries.refetch();
              }}
              type="button"
            >
              {page.retry}
            </button>
          </div>
        ) : null}
        {entries.data !== undefined && entries.data.length === 0 ? (
          <div className="mt-4 border-t border-border pt-3.5" data-testid="support-access-empty">
            <p className="text-sm font-semibold">{page.emptyTitle}</p>
            <p className="text-[12.5px] text-muted-foreground">{page.emptyBody}</p>
          </div>
        ) : null}
        {entries.data !== undefined && entries.data.length > 0 ? (
          <ol className="mt-3" data-testid="support-access-list">
            {entries.data.map((entry) => (
              <li
                className="border-t border-border py-3.5"
                data-action={entry.action}
                key={entry.id}
              >
                <p className="text-[12.5px] text-muted-foreground">
                  <time dateTime={new Date(entry.at).toISOString()}>{stamp(entry.at)}</time>
                </p>
                <p className="mt-0.5 text-sm font-semibold">{actionLabel(entry.action)}</p>
                <p className="mt-1 text-[13px] leading-[1.5]">
                  <span className="text-muted-foreground">{`${page.reason}: `}</span>
                  {entry.reason}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}
