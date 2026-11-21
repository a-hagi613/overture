import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ReactNode } from "react";

import { copy } from "../../shared/copy.ts";
import { ExportCard } from "../components/export-card.tsx";
import { SettingsHeader } from "../components/settings-header.tsx";
import { SettingsTabs } from "../components/settings-tabs.tsx";
import { downloadExport, fetchExportState, requestExport } from "../lib/export-api.ts";
import { fetchProfileSettings } from "../lib/profile-api.ts";

function zoneNow() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function dayText(at: number, zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: zone,
    weekday: "short",
  }).format(new Date(at));
}

function stampText(at: number, zone: string) {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date(at));

  return `${dayText(at, zone)}, ${time}`;
}

const primaryButton =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-foreground px-[18px] text-[13.5px] font-semibold text-primary-ink hover:bg-btn-hover disabled:cursor-not-allowed disabled:opacity-70";

const secondaryButton =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70";

export function SettingsExportPage() {
  const queryClient = useQueryClient();
  const [download, setDownload] = useState<"idle" | "working" | "failed">("idle");

  const settings = useQuery({ queryKey: ["profile-settings"], queryFn: fetchProfileSettings });

  const state = useQuery({
    queryKey: ["account-export"],
    queryFn: fetchExportState,
    refetchInterval: (query) => (query.state.data?.status === "preparing" ? 3000 : false),
  });

  const request = useMutation({
    mutationFn: requestExport,
    onSuccess: (result) => {
      queryClient.setQueryData(["account-export"], result);
    },
  });

  const zone = settings.data?.timezone ?? zoneNow();
  const current = state.data;

  const note =
    request.data?.replaced === true && current?.id === request.data.id
      ? copy.settings.exportPage.replacedNote
      : null;

  const startDownload = async (url: string) => {
    setDownload("working");

    try {
      await downloadExport(url);
      setDownload("idle");
    } catch {
      setDownload("failed");
    }
  };

  const requestButton = (
    <button
      className={primaryButton}
      disabled={request.isPending}
      onClick={() => {
        request.mutate();
      }}
      type="button"
    >
      {copy.settings.exportPage.requestButton}
    </button>
  );

  let card: ReactNode;

  if (current === undefined || current.status === "none") {
    card = (
      <ExportCard action={requestButton} heading={copy.settings.exportPage.requestHeading}>
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          {copy.settings.exportPage.requestBody}
        </p>
      </ExportCard>
    );
  } else if (current.status === "preparing") {
    card = (
      <ExportCard
        action={
          <button className={secondaryButton} disabled type="button">
            {copy.settings.exportPage.preparingButton}
          </button>
        }
        heading={copy.settings.exportPage.preparingHeading}
        pill={{ label: copy.settings.exportPage.preparingPill, tone: "plain" }}
      >
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          {copy.settings.exportPage.preparingBody(
            current.requestedAt === null ? "" : stampText(current.requestedAt, zone),
          )}
        </p>
      </ExportCard>
    );
  } else if (current.status === "ready" && current.downloadUrl !== null) {
    card = (
      <ExportCard
        action={
          <button
            className={primaryButton}
            disabled={download === "working"}
            onClick={() => {
              void startDownload(current.downloadUrl ?? "");
            }}
            type="button"
          >
            {download === "working"
              ? copy.settings.exportPage.downloading
              : copy.settings.exportPage.readyButton}
          </button>
        }
        heading={copy.settings.exportPage.readyHeading}
        pill={{ label: copy.settings.exportPage.readyPill, tone: "ready" }}
      >
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          {copy.settings.exportPage.readyBody(
            current.expiresAt === null ? "" : stampText(current.expiresAt, zone),
          )}
        </p>
      </ExportCard>
    );
  } else if (current.status === "expired") {
    card = (
      <ExportCard
        action={requestButton}
        heading={copy.settings.exportPage.expiredHeading}
        pill={{ label: copy.settings.exportPage.expiredPill, tone: "plain" }}
      >
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          {copy.settings.exportPage.expiredBody(
            current.expiresAt === null ? "" : dayText(current.expiresAt, zone),
          )}
        </p>
      </ExportCard>
    );
  } else {
    card = (
      <ExportCard action={requestButton} heading={copy.settings.exportPage.failedHeading}>
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          {copy.settings.exportPage.failedBody}
        </p>
      </ExportCard>
    );
  }

  return (
    <div className="mx-auto max-w-[940px] pt-[7px]">
      <SettingsHeader
        eyebrow={copy.settings.exportPage.eyebrow}
        lead={copy.settings.exportPage.lead}
        titleNode={
          <>
            {copy.settings.exportPage.titlePlain}
            <span className="italic">{copy.settings.exportPage.titleItalic}</span>
          </>
        }
      />
      <SettingsTabs />
      <div className="mt-[29px] grid grid-cols-1 items-start gap-[22px] min-[900px]:grid-cols-2">
        {card}
      </div>
      {note === null ? null : (
        <output className="mt-3 block text-[12.5px] text-muted-foreground">{note}</output>
      )}
      {download === "failed" ? (
        <p className="mt-3 text-[12.5px] text-need" role="alert">
          {copy.settings.exportPage.downloadFailed}
        </p>
      ) : null}
    </div>
  );
}
