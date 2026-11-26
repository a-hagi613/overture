import { useCallback } from "react";
import type { ReactNode } from "react";

import { copy } from "../../../shared/copy.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import type { ApplicationLookup } from "../../lib/admin-api.ts";
import { AdminHttpError, loadApplicationLookup } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";

const CARD = "rounded-lg border border-border bg-card px-6 py-5 shadow-sh";
const ROW = "grid gap-1 rounded-md border border-border px-3 py-2 text-sm";

function renderEmpty(label: string) {
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

function renderSection(heading: string, body: ReactNode) {
  return (
    <section className={`mt-5 ${CARD}`}>
      <h2 className="font-serif text-card-title leading-[1.1]">{heading}</h2>
      <div className="mt-3">{body}</div>
    </section>
  );
}

function renderTimeline(view: ApplicationLookup) {
  if (view.timeline.length === 0) {
    return renderEmpty(copy.admin.lookupTimelineEmpty);
  }

  return (
    <ul className="grid gap-2">
      {view.timeline.map((entry) => (
        <li className={ROW} key={entry.id}>
          <span className="font-semibold">
            {`${adminDayTime(entry.at, view.now)} · ${entry.kind} · ${entry.source}`}
          </span>
          <span className="break-words text-muted-foreground">
            {`${entry.fromValue ?? "—"} → ${entry.toValue ?? "—"}`}
          </span>
          <span className="break-all text-muted-foreground">
            {`${copy.admin.lookupReason}: ${entry.reason ?? "—"}`}
          </span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {`${copy.admin.lookupAttempt}: ${entry.attemptId ?? "—"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderQueue(view: ApplicationLookup) {
  if (view.queue.jobs.length === 0) {
    return renderEmpty(copy.admin.lookupQueueEmpty);
  }

  return (
    <ul className="grid gap-2">
      {view.queue.jobs.map((job) => (
        <li className={ROW} key={job.id}>
          <span className="font-semibold">{job.kind}</span>
          <span className="text-muted-foreground">
            {`${job.status} · ${copy.admin.lookupRunAt} ${adminDayTime(job.runAt, view.now)}`}
          </span>
          <span className="text-muted-foreground">
            {`${copy.admin.lookupTries} ${String(job.attempts)}/${String(job.maxAttempts)}`}
          </span>
          <span className="break-words text-muted-foreground">
            {`${copy.admin.lookupError}: ${job.lastError ?? "—"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderAttempts(view: ApplicationLookup) {
  if (view.attempts.length === 0) {
    return renderEmpty(copy.admin.lookupAttemptsEmpty);
  }

  return (
    <ul className="grid gap-2">
      {view.attempts.map((attempt) => (
        <li className={ROW} key={attempt.id}>
          <span className="break-all font-mono text-xs">{attempt.id}</span>
          <span className="text-muted-foreground">
            {`${attempt.outcome ?? copy.admin.lookupRunning} · ${attempt.provider}`}
          </span>
          <span className="text-muted-foreground">
            {`${copy.admin.lookupStarted} ${adminDayTime(attempt.startedAt, view.now)}`}
          </span>
          <span className="text-muted-foreground">
            {`${copy.admin.lookupSubmitColumn}: ${
              attempt.submitClickedAt === null
                ? "—"
                : adminDayTime(attempt.submitClickedAt, view.now)
            } · ${copy.admin.lookupResponse}: ${String(attempt.submitResponseStatus ?? "—")}`}
          </span>
          <span className="break-words text-muted-foreground">
            {`${copy.admin.lookupError}: ${attempt.errorCode ?? "—"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderConfirmation(view: ApplicationLookup) {
  const { receipt, snapshot } = view.confirmation;

  if (receipt === null && snapshot === null) {
    return renderEmpty(copy.admin.lookupConfirmationNone);
  }

  return (
    <dl className="grid gap-3 text-sm md:grid-cols-2">
      <div>
        <dt className="font-semibold">{copy.admin.lookupSnapshot}</dt>
        <dd className="break-words text-muted-foreground">
          {snapshot === null
            ? "—"
            : `${snapshot.confirmedBy} · ${adminDayTime(snapshot.submittedAt, view.now)} · ${snapshot.provider}`}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupReceipt}</dt>
        <dd className="break-all text-muted-foreground">
          {receipt === null
            ? "—"
            : `${receipt.messageId} · ${adminDayTime(receipt.confirmedAt, view.now)}`}
        </dd>
      </div>
    </dl>
  );
}

function renderBalance(view: ApplicationLookup) {
  if (view.balance === null) {
    return renderEmpty(copy.admin.lookupBalanceEmpty);
  }

  const { available = 0, reserved = 0, used = 0 } = view.balance.balances;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {copy.admin.lookupBalances(available, reserved, used)}
      </p>
      {view.balance.ledger.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{copy.admin.lookupBalanceEmpty}</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {view.balance.ledger.map((entry) => (
            <li className={ROW} key={entry.id}>
              <span className="font-semibold">{entry.kind}</span>
              <span className="text-muted-foreground">
                {`${adminDayTime(entry.createdAt, view.now)} · ${String(entry.amount)} · ${entry.debitAccount} → ${entry.creditAccount}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function renderMail(view: ApplicationLookup) {
  if (view.mail.length === 0) {
    return renderEmpty(copy.admin.lookupMailEmpty);
  }

  return (
    <div className="grid gap-3">
      {view.mail.map((thread) => (
        <div className="rounded-md border border-border px-3 py-2" key={thread.id}>
          <p className="break-words text-sm font-semibold">
            {thread.subject ?? copy.admin.lookupNoSubject}
          </p>
          <p className="text-xs text-muted-foreground">
            {copy.admin.lookupMailThread(thread.messages.length, thread.employerStarted)}
          </p>
          <ul className="mt-2 grid gap-1">
            {thread.messages.map((message) => (
              <li className="break-words text-sm" key={message.id}>
                {`${adminDayTime(message.createdAt, view.now)} · ${message.direction} · ${
                  message.classification ?? message.auth
                }${message.outStatus === null ? "" : ` · ${message.outStatus}`} · ${
                  message.subject ?? copy.admin.lookupNoSubject
                }`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function renderScreenshots(view: ApplicationLookup) {
  if (view.screenshots.length === 0) {
    return renderEmpty(copy.admin.lookupScreenshotsEmpty);
  }

  return (
    <ul className="grid gap-2">
      {view.screenshots.map((screenshot) => (
        <li className={ROW} key={screenshot.key}>
          <span className="font-semibold">{screenshot.phase}</span>
          <span className="text-muted-foreground">
            {`${adminDayTime(screenshot.at, view.now)} · ${copy.admin.lookupBytes}: ${String(screenshot.bytes ?? "—")}`}
          </span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {screenshot.attemptId}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderApplicationSummary(view: ApplicationLookup) {
  const { application } = view;

  if (application === null) {
    return renderEmpty(copy.admin.lookupNotFound);
  }

  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="font-semibold">{copy.admin.lookupCompany}</dt>
        <dd className="break-words text-muted-foreground">
          {`${application.companyName} · ${application.postingTitle}`}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupStatus}</dt>
        <dd className="break-words text-muted-foreground">
          {`${application.status}${
            application.statusReason === null ? "" : ` · ${application.statusReason}`
          }`}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupStage}</dt>
        <dd className="text-muted-foreground">
          {`${application.stage ?? "—"} · ${application.ats ?? copy.admin.lookupUnknownAts}`}
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
        <dd className="break-all font-mono text-xs text-muted-foreground">{application.userId}</dd>
      </div>
      <div>
        <dt className="font-semibold">{copy.admin.lookupCreated}</dt>
        <dd className="text-muted-foreground">{adminDayTime(application.createdAt, view.now)}</dd>
      </div>
    </dl>
  );
}

export function LookupResult({ applicationId }: { applicationId: string }) {
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
      {renderSection(copy.admin.lookupSummaryHeading, renderApplicationSummary(data))}
      {renderSection(copy.admin.lookupTimelineHeading, renderTimeline(data))}
      {renderSection(copy.admin.lookupAttemptsHeading, renderAttempts(data))}
      {renderSection(copy.admin.lookupQueueHeading, renderQueue(data))}
      {renderSection(copy.admin.lookupConfirmationHeading, renderConfirmation(data))}
      {renderSection(copy.admin.lookupBalanceHeading, renderBalance(data))}
      {renderSection(copy.admin.lookupMailHeading, renderMail(data))}
      {renderSection(copy.admin.lookupScreenshotsHeading, renderScreenshots(data))}
    </>
  );
}
