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
import { HomeChart } from "../components/home-chart.tsx";
import { HomeCheckIn } from "../components/home-checkin.tsx";
import { HomeCodeWait } from "../components/home-code-wait.tsx";
import { HomeInbox } from "../components/home-inbox.tsx";
import { HomeKpis } from "../components/home-kpis.tsx";
import { HomeNeedsYou } from "../components/home-needs-you.tsx";
import { HomePauseBanner } from "../components/home-pause-banner.tsx";
import { HomeQueue } from "../components/home-queue.tsx";
import { HomeReadyCard } from "../components/home-ready-card.tsx";
import { HomeStrengthen } from "../components/home-strengthen.tsx";
import { PageHeader } from "../components/page-header.tsx";

interface OpenSheet {
  error: string | null;
  mode: CodePasteMode;
  wait: CodeWait;
}

const RANGE_KEYS: readonly HomeRangeKey[] = ["7D", "30D", "90D"];

const DAYS: Record<HomeRangeKey, number> = { "7D": 7, "30D": 30, "90D": 90 };

const RANGE_LABELS: Record<HomeRangeKey, string> = {
  "7D": copy.home.ranges.d7,
  "30D": copy.home.ranges.d30,
  "90D": copy.home.ranges.d90,
};

function dateLine() {
  const now = new Date();

  const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}

function greetingWord() {
  const hour = new Date().getHours();

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

  const sheetMode = sheet === null ? null : liveMode(sheet);

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

    paste.mutate(
      { code, waitId: sheet.wait.id },
      {
        onError: (failure) => {
          const outcome = failure instanceof CodePasteError ? failure.outcome : "failed";

          if (outcome === "expired") {
            setSheet((current) =>
              current === null
                ? current
                : { ...current, error: copy.codePaste.errors.expired, mode: "expired" },
            );
          } else if (outcome === "resolved") {
            setSheet((current) => (current === null ? current : { ...current, mode: "accepted" }));
          } else {
            setSheet((current) =>
              current === null
                ? current
                : {
                    ...current,
                    error:
                      outcome === "not_found"
                        ? copy.codePaste.errors.notFound
                        : copy.codePaste.errors.failed,
                  },
            );
          }
        },
        onSuccess: () => {
          setSheet((current) => (current === null ? current : { ...current, mode: "accepted" }));
        },
      },
    );
  }

  return (
    <div>
      <PageHeader
        lead={dateLine()}
        titleNode={
          <>
            {greetingWord()}{" "}
            <span className="italic">{`${firstName === "" ? copy.app.name : firstName}.`}</span>
          </>
        }
      />
      {home?.pauseReason === null || home?.pauseReason === undefined ? null : (
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
      {paused || home === undefined ? null : <HomeReadyCard ready={home.ready} />}
      <div className="mt-[30px] flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-[26px] leading-[1.5]">{copy.home.daySoFar}</h2>
        <fieldset
          aria-label={copy.home.rangeLabel}
          className="m-0 inline-flex min-w-0 gap-0.5 rounded-lg border border-border bg-muted p-[3px]"
        >
          {RANGE_KEYS.map((key) => (
            <button
              aria-pressed={key === rangeKey}
              className={`inline-flex min-h-[34px] items-center rounded-[5px] px-[15px] text-[12.5px] font-semibold ${
                key === rangeKey
                  ? "bg-card text-foreground shadow-sh"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={key}
              onClick={() => {
                setRangeKey(key);
              }}
              type="button"
            >
              {RANGE_LABELS[key]}
            </button>
          ))}
        </fieldset>
      </div>
      {home === undefined || range === null ? null : (
        <>
          <HomeKpis days={DAYS[rangeKey]} home={home} paused={paused} range={range} />
          <div className="mt-5 flex flex-wrap items-stretch gap-5">
            <HomeChart range={range} rangeKey={rangeKey} />
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
          <HomeInbox now={home.now} rows={home.recentInbox} zone={home.timeZone} />
        </>
      )}
      {sheet === null || sheetMode === null ? null : (
        <CodePasteSheet
          error={sheet.error}
          mode={sheetMode}
          onClose={() => {
            setSheet(null);
          }}
          onNoCode={() => {
            updateSheet({ mode: "no_code" });
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
