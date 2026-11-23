import { useEffect, useState } from "react";

import type { HomeRangeKey } from "../lib/home-api.ts";
import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { CodePasteError, isAtAskTime, useCodeWaits, usePasteCode } from "../lib/code-wait-api.ts";
import { firstNameOf } from "../lib/identity.ts";
import { useHomeData } from "../lib/home-api.ts";
import { CodePasteSheet } from "../components/code-paste-sheet.tsx";
import type { CodePasteMode } from "../components/code-paste-sheet.tsx";
import { HomeActivity } from "../components/home-activity.tsx";
import { HomeBillingNotice } from "../components/home-billing-notice.tsx";
import { HomeChart } from "../components/home-chart.tsx";
import { HomeCheckIn } from "../components/home-checkin.tsx";
import { HomeCodeWait } from "../components/home-code-wait.tsx";
import { HomeControlBand } from "../components/home-control-band.tsx";
import { HomeInbox } from "../components/home-inbox.tsx";
import { HomeNeedsYou } from "../components/home-needs-you.tsx";
import { HomePauseBanner } from "../components/home-pause-banner.tsx";
import { HomeQueue } from "../components/home-queue.tsx";
import { HomeReadyCard } from "../components/home-ready-card.tsx";
import { HomeSchedule } from "../components/home-schedule.tsx";
import { HomeStrengthen } from "../components/home-strengthen.tsx";
import { PageHeader } from "../components/page-header.tsx";

interface OpenSheet {
  error: string | null;
  mode: CodePasteMode;
  wait: CodeWait;
}

function dateLine(zone: string | undefined) {
  const now = new Date();

  try {
    const timeZone = zone === undefined ? undefined : { timeZone: zone };
    const weekday = now.toLocaleDateString(copy.home.dateLocale, { ...timeZone, weekday: "long" });
    const month = now.toLocaleDateString(copy.home.dateLocale, { ...timeZone, month: "long" });
    const day = now.toLocaleDateString(copy.home.dateLocale, { ...timeZone, day: "numeric" });

    return `${weekday}, ${month} ${day}`;
  } catch {
    const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
    const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

    return `${weekday}, ${month} ${String(now.getDate())}`;
  }
}

function greetingWord(zone: string | undefined) {
  const now = new Date();
  let hour = now.getHours();

  if (zone !== undefined) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: zone,
      }).formatToParts(now);

      const formattedHour = Number(parts.find((part) => part.type === "hour")?.value);

      if (!Number.isNaN(formattedHour)) {
        hour = formattedHour % 24;
      }
    } catch {
      hour = now.getHours();
    }
  }

  if (hour < 12) {
    return copy.home.greetingMorning;
  }

  return hour < 18 ? copy.home.greetingAfternoon : copy.home.greetingEvening;
}

export function HomePage() {
  const { data: session } = authClient.useSession();
  const name = session === null ? "" : session.user.name;
  const firstName = name === "" ? "" : firstNameOf(name);
  const { data: home } = useHomeData();
  const { data: codeWaits } = useCodeWaits();
  const paste = usePasteCode();
  const [rangeKey, setRangeKey] = useState<HomeRangeKey>("7D");
  const [sheet, setSheet] = useState<OpenSheet | null>(null);

  const range = home?.ranges[rangeKey] ?? null;
  const paused = home?.pauseReason !== null && home?.pauseReason !== undefined;
  const waits = codeWaits?.waits ?? [];
  const wait = waits[0] ?? null;
  const asked = wait !== null && isAtAskTime(wait, codeWaits?.now ?? 0);

  function liveMode(open: OpenSheet) {
    if (open.mode === "accepted" || open.mode === "expired") {
      return open.mode;
    }

    if (waits.some((entry) => entry.id === open.wait.id)) {
      return open.mode;
    }

    return open.wait.expiresAt <= (codeWaits?.now ?? 0) ? "expired" : "accepted";
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSheet(null);
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, []);

  function updateSheet(patch: Partial<OpenSheet>) {
    setSheet((current) => (current === null ? current : { ...current, ...patch }));
  }

  function openSheet(entry: CodeWait, mode: CodePasteMode) {
    setSheet({ error: null, mode, wait: entry });
  }

  function submitCode(code: string) {
    if (sheet === null) {
      return;
    }

    updateSheet({ error: null });

    paste.mutate(
      { code, waitId: sheet.wait.id },
      {
        onError: (failure) => {
          const outcome = failure instanceof CodePasteError ? failure.outcome : "failed";

          if (outcome === "expired") {
            updateSheet({ error: copy.codePaste.errors.expired, mode: "expired" });
          } else if (outcome === "resolved") {
            updateSheet({ error: null, mode: "accepted" });
          } else {
            updateSheet({
              error:
                outcome === "not_found"
                  ? copy.codePaste.errors.notFound
                  : copy.codePaste.errors.failed,
            });
          }
        },
        onSuccess: () => {
          updateSheet({ error: null, mode: "accepted" });
        },
      },
    );
  }

  return (
    <div>
      <PageHeader
        lead={dateLine(home?.timeZone)}
        titleNode={
          <>
            {greetingWord(home?.timeZone)}{" "}
            <em className="italic text-signal">{`${firstName === "" ? copy.app.name : firstName}.`}</em>
          </>
        }
      />

      {home?.pauseReason === null ||
      home?.pauseReason === undefined ||
      home.pauseReason === "user" ? null : (
        <HomePauseBanner reason={home.pauseReason} />
      )}

      {wait === null || !asked ? null : (
        <HomeCodeWait
          onNoCode={() => {
            openSheet(wait, "no_code");
          }}
          onPaste={() => {
            openSheet(wait, "waiting");
          }}
          serverNow={codeWaits?.now}
          wait={wait}
        />
      )}

      {home === undefined ? null : (
        <>
          <HomeBillingNotice
            applicationsLeft={home.applicationsLeft}
            endingGrant={home.endingGrant}
            planApplications={home.planApplications}
          />
          <HomeControlBand home={home} />
        </>
      )}

      {home === undefined || range === null ? null : (
        <>
          <HomeChart onRangeChange={setRangeKey} range={range} rangeKey={rangeKey} />

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <HomeReadyCard readyCount={home.ready.ready} />
            <HomeNeedsYou
              applications={home.reviews.applications}
              reviews={home.reviews.list}
              total={home.reviews.total}
            />
          </div>

          {paused || home.checkIns.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-stretch gap-5">
              {paused ? (
                <HomeQueue
                  position={home.queue.position}
                  sendAt={home.queue.sendAt}
                  zone={home.timeZone}
                />
              ) : null}
              {home.checkIns.length > 0 ? <HomeCheckIn checkIns={home.checkIns} /> : null}
            </div>
          ) : null}

          {paused ? (
            <>
              <HomeActivity
                failed={home.activity.failed}
                now={home.now}
                sent={home.activity.sent}
                zone={home.timeZone}
              />
              {home.strengthen === null ? null : (
                <HomeStrengthen missing={home.strengthen.missing} />
              )}
            </>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <HomeInbox now={home.now} rows={home.recentInbox} zone={home.timeZone} />
            <HomeSchedule now={home.now} zone={home.timeZone} />
          </div>
        </>
      )}

      {sheet === null ? null : (
        <CodePasteSheet
          error={sheet.error}
          mode={liveMode(sheet)}
          onClose={() => {
            setSheet(null);
          }}
          onNoCode={() => {
            updateSheet({ error: null, mode: "no_code" });
          }}
          onSubmit={submitCode}
          pending={paste.isPending}
          serverNow={codeWaits?.now}
          wait={sheet.wait}
        />
      )}
    </div>
  );
}
