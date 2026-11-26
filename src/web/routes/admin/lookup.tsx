import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import type { ApplicationLookup } from "../../lib/admin-api.ts";
import { AdminHttpError, loadApplicationLookup } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";

const CARD = "rounded-lg border border-border bg-card px-6 py-5 shadow-sh";
const FIELD =
  "min-h-11 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";
const BUTTON =
  "min-h-11 rounded-md border border-input bg-card px-4 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";
const CELL = "border-b border-border px-3 py-2 text-left align-top text-sm";

function Section({ children, heading }: { children: ReactNode; heading: string }) {
  return (
    <section className={`mt-5 ${CARD}`}>
      <h2 className="font-serif text-card-title leading-[1.1]">{heading}</h2>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Timeline({ view }: { view: ApplicationLookup }) {
  if (view.timeline.length === 0) {
    return <Empty>{copy.admin.lookupTimelineEmpty}</Empty>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={CELL}>{copy.admin.lookupTime}</th>
          <th className={CELL}>{copy.admin.lookupEvent}</th>
          <th className={CELL}>{copy.admin.lookupMove}</th>
          <th className={CELL}>{copy.admin.lookupReason}</th>
          <th className={CELL}>{copy.admin.lookupAttempt}</th>
        </tr>
      </thead>
      <tbody>
        {view.timeline.map((entry) => (
          <tr key={entry.id}>
            <td className={CELL}>{adminDayTime(entry.at, view.now)}</td>
            <td className={CELL}>
              {entry.kind} · {entry.source}
            </td>
            <td className={CELL}>
              {entry.fromValue ?? "—"} → {entry.toValue ?? "—"}
            </td>
            <td className={CELL}>{entry.reason ?? "—"}</td>
            <td className={`${CELL} font-mono text-xs`}>{entry.attemptId ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Queue({ view }: { view: ApplicationLookup }) {
  if (view.queue.jobs.length === 0) {
    return <Empty>{copy.admin.lookupQueueEmpty}</Empty>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={CELL}>{copy.admin.lookupJob}</th>
          <th className={CELL}>{copy.admin.lookupStatus}</th>
          <th className={CELL}>{copy.admin.lookupRunAt}</th>
          <th className={CELL}>{copy.admin.lookupTries}</th>
          <th className={CELL}>{copy.admin.lookupError}</th>
        </tr>
      </thead>
      <tbody>
        {view.queue.jobs.map((job) => (
          <tr key={job.id}>
            <td className={CELL}>{job.kind}</td>
            <td className={CELL}>{job.status}</td>
            <td className={CELL}>{adminDayTime(job.runAt, view.now)}</td>
            <td className={CELL}>
              {job.attempts}/{job.maxAttempts}
            </td>
            <td className={CELL}>{job.lastError ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Attempts({ view }: { view: ApplicationLookup }) {
  if (view.attempts.length === 0) {
    return <Empty>{copy.admin.lookupAttemptsEmpty}</Empty>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={CELL}>{copy.admin.lookupAttempt}</th>
          <th className={CELL}>{copy.admin.lookupStatus}</th>
          <th className={CELL}>{copy.admin.lookupStarted}</th>
          <th className={CELL}>{copy.admin.lookupSubmit}</th>
          <th className={CELL}>{copy.admin.lookupResponse}</th>
          <th className={CELL}>{copy.admin.lookupError}</th>
        </tr>
      </thead>
      <tbody>
        {view.attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td className={`${CELL} font-mono text-xs`}>{attempt.id}</td>
            <td className={CELL}>
              {attempt.outcome ?? copy.admin.lookupRunning} · {attempt.provider}
            </td>
            <td className={CELL}>{adminDayTime(attempt.startedAt, view.now)}</td>
            <td className={CELL}>
              {attempt.submitClickedAt === null
                ? "—"
                : adminDayTime(attempt.submitClickedAt, view.now)}
            </td>
            <td className={CELL}>{attempt.submitResponseStatus ?? "—"}</td>
            <td className={CELL}>{attempt.errorCode ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Confirmation({ view }: { view: ApplicationLookup }) {
  const { receipt, snapshot } = view.confirmation;

  if (receipt === null && snapshot === null) {
    return <Empty>{copy.admin.lookupConfirmationNone}</Empty>;
  }

  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="font-semibold">{copy.admin.lookupSnapshot}</dt>
        <dd className="text-muted-foreground">
          {snapshot === null
            ? "—"
            : `${snapshot.confirmedBy} · ${adminDayTime(snapshot.submittedAt, view.now)} · ${snapshot.provider}`}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupReceipt}</dt>
        <dd className="text-muted-foreground">
          {receipt === null
            ? "—"
            : `${receipt.messageId} · ${adminDayTime(receipt.confirmedAt, view.now)}`}
        </dd>
      </div>
    </dl>
  );
}

function Balance({ view }: { view: ApplicationLookup }) {
  if (view.balance === null) {
    return <Empty>{copy.admin.lookupBalanceEmpty}</Empty>;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {copy.admin.lookupBalances(
          view.balance.balances.available ?? 0,
          view.balance.balances.reserved ?? 0,
          view.balance.balances.used ?? 0,
        )}
      </p>
      {view.balance.ledger.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{copy.admin.lookupBalanceEmpty}</p>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr>
              <th className={CELL}>{copy.admin.lookupTime}</th>
              <th className={CELL}>{copy.admin.lookupKind}</th>
              <th className={CELL}>{copy.admin.lookupAmount}</th>
              <th className={CELL}>{copy.admin.lookupAccounts}</th>
            </tr>
          </thead>
          <tbody>
            {view.balance.ledger.map((entry) => (
              <tr key={entry.id}>
                <td className={CELL}>{adminDayTime(entry.createdAt, view.now)}</td>
                <td className={CELL}>{entry.kind}</td>
                <td className={CELL}>{entry.amount}</td>
                <td className={CELL}>
                  {entry.debitAccount} → {entry.creditAccount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Mail({ view }: { view: ApplicationLookup }) {
  if (view.mail.length === 0) {
    return <Empty>{copy.admin.lookupMailEmpty}</Empty>;
  }

  return (
    <div className="grid gap-3">
      {view.mail.map((thread) => (
        <div className="rounded-md border border-border px-3 py-2" key={thread.id}>
          <p className="text-sm font-semibold">{thread.subject ?? copy.admin.lookupNoSubject}</p>
          <p className="text-xs text-muted-foreground">
            {copy.admin.lookupMailThread(thread.messages.length, thread.employerStarted)}
          </p>
          <ul className="mt-2 grid gap-1">
            {thread.messages.map((message) => (
              <li className="text-sm" key={message.id}>
                {adminDayTime(message.createdAt, view.now)} · {message.direction} ·{" "}
                {message.classification ?? message.auth}
                {message.outStatus === null ? "" : ` · ${message.outStatus}`} ·{" "}
                {message.subject ?? copy.admin.lookupNoSubject}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Screenshots({ view }: { view: ApplicationLookup }) {
  if (view.screenshots.length === 0) {
    return <Empty>{copy.admin.lookupScreenshotsEmpty}</Empty>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={CELL}>{copy.admin.lookupTime}</th>
          <th className={CELL}>{copy.admin.lookupPhase}</th>
          <th className={CELL}>{copy.admin.lookupAttempt}</th>
          <th className={CELL}>{copy.admin.lookupBytes}</th>
        </tr>
      </thead>
      <tbody>
        {view.screenshots.map((screenshot) => (
          <tr key={screenshot.key}>
            <td className={CELL}>{adminDayTime(screenshot.at, view.now)}</td>
            <td className={CELL}>{screenshot.phase}</td>
            <td className={`${CELL} font-mono text-xs`}>{screenshot.attemptId}</td>
            <td className={CELL}>{screenshot.bytes ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApplicationSummary({ view }: { view: ApplicationLookup }) {
  const application = view.application;

  if (application === null) {
    return <Empty>{copy.admin.lookupNotFound}</Empty>;
  }

  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="font-semibold">{copy.admin.lookupCompany}</dt>
        <dd className="text-muted-foreground">
          {application.companyName} · {application.postingTitle}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupStatus}</dt>
        <dd className="text-muted-foreground">
          {application.status}
          {application.statusReason === null ? "" : ` · ${application.statusReason}`}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupStage}</dt>
        <dd className="text-muted-foreground">
          {application.stage ?? "—"} · {application.ats ?? copy.admin.lookupUnknownAts}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupCost}</dt>
        <dd className="text-muted-foreground">
          {copy.admin.lookupCostDetail(
            application.cost.browserMicros,
            application.cost.retryMicros,
            application.cost.llmMicros,
          )}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupUser}</dt>
        <dd className="font-mono text-xs text-muted-foreground">{application.userId}</dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupCreated}</dt>
        <dd className="text-muted-foreground">{adminDayTime(application.createdAt, view.now)}</dd>
      </div>
    </dl>
  );
}

function LookupResult({ applicationId }: { applicationId: string }) {
  const load = useCallback(async () => await loadApplicationLookup(applicationId), [applicationId]);
  const { data, error, failed, refusal, refresh } = useAdminResource(load, [
    "lookup",
    applicationId,
  ]);

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  if (error instanceof AdminHttpError && error.status === 404) {
    return (
      <div className={`mt-5 ${CARD}`}>
        <p className="text-sm text-muted-foreground">{copy.admin.lookupNotFound}</p>
      </div>
    );
  }

  if (data === null) {
    return <AdminStatusCard failed={failed} onRetry={refresh} />;
  }

  if (data.application === null) {
    return (
      <div className={`mt-5 ${CARD}`}>
        <p className="text-sm text-muted-foreground">{copy.admin.lookupNotFound}</p>
      </div>
    );
  }

  return (
    <>
      <Section heading={copy.admin.lookupSummaryHeading}>
        <ApplicationSummary view={data} />
      </Section>
      <Section heading={copy.admin.lookupTimelineHeading}>
        <Timeline view={data} />
      </Section>
      <Section heading={copy.admin.lookupAttemptsHeading}>
        <Attempts view={data} />
      </Section>
      <Section heading={copy.admin.lookupQueueHeading}>
        <Queue view={data} />
      </Section>
      <Section heading={copy.admin.lookupConfirmationHeading}>
        <Confirmation view={data} />
      </Section>
      <Section heading={copy.admin.lookupBalanceHeading}>
        <Balance view={data} />
      </Section>
      <Section heading={copy.admin.lookupMailHeading}>
        <Mail view={data} />
      </Section>
      <Section heading={copy.admin.lookupScreenshotsHeading}>
        <Screenshots view={data} />
      </Section>
    </>
  );
}

export function ApplicationLookupPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const applicationId = searchParams.get("application")?.trim() ?? "";
  const [draft, setDraft] = useState(applicationId);

  useEffect(() => {
    setDraft(applicationId);
  }, [applicationId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const next = new URLSearchParams(searchParams);
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      next.delete("application");
    } else {
      next.set("application", trimmed);
    }

    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.lookupTitleItalic}
        lead={copy.admin.lookupLead}
        plain={copy.admin.lookupTitlePlain}
      />
      <p className="mt-2 max-w-[62ch] text-sm text-muted-foreground">{copy.admin.lookupIntro}</p>

      <form className={`mt-5 ${CARD}`} onSubmit={submit}>
        <label className="block text-xs font-semibold" htmlFor="lookup-application">
          {copy.admin.lookupLabel}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${FIELD} min-w-0 flex-1 font-mono`}
            id="lookup-application"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.admin.lookupPlaceholder}
            value={draft}
          />
          <button className={BUTTON} type="submit">
            {copy.admin.lookupSubmit}
          </button>
        </div>
      </form>

      {applicationId.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">{copy.admin.lookupMissing}</p>
      ) : (
        <LookupResult applicationId={applicationId} />
      )}
    </>
  );
}
