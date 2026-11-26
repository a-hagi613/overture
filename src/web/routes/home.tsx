import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import type { HomeRangeKey } from "../lib/home-api.ts";
import type { CodeWait } from "../lib/code-wait-api.ts";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { CodePasteError, isAtAskTime, useCodeWaits, usePasteCode } from "../lib/code-wait-api.ts";
import { homeActionStateOf, isAllCaughtUp } from "../lib/home-bands.ts";
import { firstNameOf } from "../lib/identity.ts";
import { useHomeData } from "../lib/home-api.ts";
import { CodePasteSheet } from "../components/code-paste-sheet.tsx";
import type { CodePasteMode } from "../components/code-paste-sheet.tsx";
import { HomeBillingNotice } from "../components/home-billing-notice.tsx";
import { HomeCaughtUp } from "../components/home-caught-up.tsx";
import { HomeChart } from "../components/home-chart.tsx";
import { HomeCheckIn } from "../components/home-checkin.tsx";
import { HomeCodeWait } from "../components/home-code-wait.tsx";
import { HomeControlBand } from "../components/home-control-band.tsx";
import { HomeFailures } from "../components/home-failures.tsx";
import { HomeInProgress } from "../components/home-in-progress.tsx";
import { HomeMatches } from "../components/home-matches.tsx";
import { HomeNeedsYou } from "../components/home-needs-you.tsx";
import { HomePauseBanner } from "../components/home-pause-banner.tsx";
import { HomeReadyCard } from "../components/home-ready-card.tsx";
import { HomeReplies } from "../components/home-replies.tsx";
import { HomeStrengthen } from "../components/home-strengthen.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";

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

  const {
    data: home,
    isError: homeError,
    isPending: homePending,
    refetch: refetchHome,
  } = useHomeData();

  const { data: codeWaits } = useCodeWaits();
  const paste = usePasteCode();
  const [rangeKey, setRangeKey] = useState<HomeRangeKey>("7D");
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const range = home?.ranges[rangeKey] ?? null;
  const waits = codeWaits?.waits ?? [];
  const wait = waits[0] ?? null;
  const asked = wait !== null && isAtAskTime(wait, codeWaits?.now ?? 0);
  const requestedWaitId = searchParams.get("codeWait");

  const requestedWait =
    requestedWaitId === null ? null : (waits.find((entry) => entry.id === requestedWaitId) ?? null);

  const activeSheet: OpenSheet | null =
    sheet ??
    (requestedWait === null ? null : { error: null, mode: "waiting", wait: requestedWait });

  const codeWaitAsking = wait !== null && asked;
  const showFailures = home !== undefined && home.activity.failed.length > 0;
  const showCheckIn = home !== undefined && home.checkIns.length > 0;
  const caughtUp = home !== undefined && isAllCaughtUp(homeActionStateOf(home), codeWaitAsking);

  const closeSheet = useCallback(() => {
    setSheet(null);

    if (searchParams.has("codeWait")) {
      const next = new URLSearchParams(searchParams);

      next.delete("codeWait");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
        closeSheet();
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [closeSheet]);

  function updateSheet(patch: Partial<OpenSheet>) {
    setSheet((current) => {
      const base = current ?? activeSheet;

      return base === null ? base : { ...base, ...patch };
    });
  }

  function openSheet(entry: CodeWait, mode: CodePasteMode) {
    setSheet({ error: null, mode, wait: entry });
  }

  function submitCode(code: string) {
    if (activeSheet === null) {
      return;
    }

    setSheet({ ...activeSheet, error: null });

    paste.mutate(
      { code, waitId: activeSheet.wait.id },
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
    <div className="flex flex-1 flex-col">
      <PageHeader
        lead={dateLine(home?.timeZone)}
        titleNode={`${greetingWord(home?.timeZone)} ${firstName === "" ? copy.app.name : firstName}`}
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

      {homePending ? (
        <div aria-busy="true" className="mt-3 space-y-3">
          <span className="sr-only">{copy.shell.loadingPage}</span>
          <Card className="p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-1/3 rounded bg-muted" />
              <div className="h-14 w-full rounded bg-muted" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="h-44 animate-pulse rounded bg-muted" />
          </Card>
        </div>
      ) : null}

      {homeError ? (
        <Card className="mt-3 flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.home.loadFailed}
          </p>
          <Button
            onClick={() => {
              void refetchHome();
            }}
            size="sm"
            variant="outline"
          >
            {copy.home.sections.retry}
          </Button>
        </Card>
      ) : null}

      {home === undefined ? null : (
        <>
          <HomeBillingNotice
            applicationsLeft={home.applicationsLeft}
            planApplications={home.planApplications}
            planKind={home.planKind}
            trialUsed={home.trialUsed}
          />

          <div className="mt-3">
            <HomeControlBand home={home} />
          </div>

          <div className="mt-3 flex flex-col gap-3" data-testid="home-attention">
            <HomeNeedsYou reviews={home.reviews.list} total={home.reviews.total} />
            <HomeReadyCard readyCount={home.ready.ready} />
            <HomeInProgress
              items={home.inProgress.items}
              total={home.inProgress.total}
              zone={home.timeZone}
            />
            <HomeReplies items={home.recentInbox} total={home.recentInbox.length} />
            <HomeMatches items={home.newMatches.items} total={home.newMatches.total} />
          </div>

          {caughtUp ? <HomeCaughtUp nextPrepAt={home.nextPrepAt} zone={home.timeZone} /> : null}

          {showFailures ? (
            <div className="mt-3">
              <HomeFailures failed={home.activity.failed} now={home.now} zone={home.timeZone} />
            </div>
          ) : null}

          {range === null ? null : (
            <HomeChart onRangeChange={setRangeKey} range={range} rangeKey={rangeKey} />
          )}

          {showCheckIn ? (
            <div className="mt-3">
              <HomeCheckIn checkIns={home.checkIns} />
            </div>
          ) : null}

          {home.strengthen === null ? null : <HomeStrengthen missing={home.strengthen.missing} />}
        </>
      )}

      {activeSheet === null ? null : (
        <CodePasteSheet
          error={activeSheet.error}
          mode={liveMode(activeSheet)}
          onClose={closeSheet}
          onNoCode={() => {
            updateSheet({ error: null, mode: "no_code" });
          }}
          onSubmit={submitCode}
          pending={paste.isPending}
          serverNow={codeWaits?.now}
          wait={activeSheet.wait}
        />
      )}
    </div>
  );
}
