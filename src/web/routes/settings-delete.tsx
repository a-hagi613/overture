import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import { PageHeader } from "../components/page-header.tsx";
import { SettingsAccountTabs } from "../components/settings-account-tabs.tsx";
import { DeleteEmailCard } from "../components/delete-email-card.tsx";
import { authClient } from "../lib/auth-client.ts";
import { fetchDeletionState, requestDeletion, sendReauthLink } from "../lib/account-api.ts";

const stepClass =
  "text-[11px] font-semibold uppercase tracking-[1.65px] leading-[normal] text-muted-foreground mb-2.5";

const cardClass =
  "flex flex-col rounded-lg border border-border bg-card p-[20px_16px_22px] shadow-sh min-[768px]:p-[24px_28px_26px]";

const headingClass = "font-serif text-[28px] leading-[1.1]";

const buttonBase =
  "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md text-[13.5px] font-semibold leading-[normal] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

const outlineDangerClass = `${buttonBase} border border-need bg-transparent px-4 text-need hover:bg-need-soft`;

const textButtonClass = `${buttonBase} border border-transparent px-3.5 text-foreground hover:bg-muted`;

const solidButtonClass = `${buttonBase} border border-foreground bg-foreground px-[18px] text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-btn-hover`;

const dangerButtonClass = `${buttonBase} border border-need bg-need px-4 text-background hover:bg-need/90`;

const errorBodySchema = z.object({ message: z.string().optional() });

async function errorMessage(response: Response) {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));

  return body.success ? (body.data.message ?? null) : null;
}

export function SettingsDeletePage() {
  const { data: session } = authClient.useSession();
  const state = useQuery({ queryKey: ["account-deletion"], queryFn: fetchDeletionState });
  const [linkSent, setLinkSent] = useState(false);
  const [checked, setChecked] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reauthRef = useRef<HTMLDivElement>(null);
  const erasingRef = useRef<HTMLDivElement>(null);

  const reauthenticated = state.data?.reauthenticated ?? false;
  const firstName = (session?.user.name ?? "").trim().split(/\s+/u)[0] ?? "";

  function focusReauth() {
    reauthRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    reauthRef.current?.querySelector("button")?.focus();
  }

  async function onSendLink() {
    setReauthError(null);
    setBusy(true);

    const response = await sendReauthLink().catch(() => null);

    setBusy(false);

    if (response === null || !response.ok) {
      setReauthError(
        (response === null ? null : await errorMessage(response)) ??
          copy.deleteAccount.errors.linkFailed,
      );

      return;
    }

    setLinkSent(true);
  }

  async function onDelete() {
    setDeleteError(null);

    if (!checked) {
      setDeleteError(copy.deleteAccount.errors.confirmRequired);

      return;
    }

    setBusy(true);

    const response = await requestDeletion().catch(() => null);

    setBusy(false);

    if (response === null) {
      setDeleteError(copy.deleteAccount.errors.deleteFailed);

      return;
    }

    if (!response.ok) {
      setDeleteError((await errorMessage(response)) ?? copy.deleteAccount.errors.deleteFailed);

      return;
    }

    setErasing(true);
    requestAnimationFrame(() => {
      erasingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="mx-auto max-w-[940px]">
      <PageHeader
        backLink={{ href: "/settings", label: copy.settings.title }}
        lead={copy.deleteAccount.lead}
        showRunningSwitch={false}
        titleNode={
          <>
            {copy.deleteAccount.titlePlain}{" "}
            <span className="italic">{copy.deleteAccount.titleItalic}</span>
          </>
        }
      />
      <SettingsAccountTabs active="delete" />
      <div className="mt-7 flex max-w-[760px] flex-col gap-5" data-testid="settings-delete">
        <div>
          <p className={stepClass}>{copy.deleteAccount.steps.warning}</p>
          <section
            aria-labelledby="delete-warning-heading"
            className={cardClass}
            data-testid="delete-warning"
          >
            <h2 className={headingClass} id="delete-warning-heading">
              {copy.deleteAccount.warningHeading}
            </h2>
            <div className="mt-3 rounded-lg border border-need bg-need-soft p-[16px_18px]">
              <p className="text-[14px] font-semibold leading-[1.5] text-need">
                {copy.deleteAccount.cannotUndo}
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-foreground">
                {copy.deleteAccount.erasedIntro}
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-[13.5px] leading-[1.7] text-foreground">
                {copy.deleteAccount.erasedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-3 text-[12.5px] leading-[1.5] text-foreground">
                <strong>{copy.deleteAccount.addressBold}</strong>{" "}
                <span className="font-mono">{copy.deleteAccount.addressSample}</span>{" "}
                {copy.deleteAccount.addressRest}
              </p>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
              {copy.deleteAccount.completes}
            </p>
            <div className="mt-[18px] flex flex-wrap gap-2.5">
              <button className={outlineDangerClass} onClick={focusReauth} type="button">
                {copy.deleteAccount.continueToDelete}
              </button>
              <Link className={textButtonClass} to="/settings">
                {copy.deleteAccount.keepAccount}
              </Link>
            </div>
          </section>
        </div>

        <div ref={reauthRef}>
          <p className={stepClass}>{copy.deleteAccount.steps.reauth}</p>
          <section
            aria-labelledby="delete-reauth-heading"
            className={cardClass}
            data-testid="delete-reauth"
          >
            <h2 className={headingClass} id="delete-reauth-heading">
              {copy.deleteAccount.reauthHeading}
            </h2>
            <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-foreground">
              {copy.deleteAccount.reauthBody}
            </p>
            <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
              <button
                className={solidButtonClass}
                disabled={busy || reauthenticated}
                onClick={() => {
                  void onSendLink();
                }}
                type="button"
              >
                {copy.deleteAccount.sendLink}
              </button>
            </div>
            {reauthenticated || linkSent ? (
              <output className="mt-3 block text-[12.5px] leading-[1.5] text-ok">
                {linkSent ? copy.deleteAccount.linkSent : copy.deleteAccount.reauthenticated}
              </output>
            ) : null}
            {reauthError === null ? null : (
              <p className="mt-3 text-[12.5px] leading-[1.5] text-need" role="alert">
                {reauthError}
              </p>
            )}
          </section>
        </div>

        <div>
          <p className={stepClass}>{copy.deleteAccount.steps.confirm}</p>
          <section
            aria-labelledby="delete-confirm-heading"
            className={cardClass}
            data-testid="delete-confirm"
          >
            <h2 className={headingClass} id="delete-confirm-heading">
              {copy.deleteAccount.confirmHeading}
            </h2>
            <div className="mt-3">
              <label className="flex min-h-[25px] cursor-pointer items-start gap-3 text-[14px] leading-[1.5]">
                <input
                  checked={checked}
                  className="mt-1 size-[18px] accent-foreground"
                  onChange={(event) => {
                    setChecked(event.target.checked);
                  }}
                  type="checkbox"
                />
                <span>{copy.deleteAccount.confirmCheckbox}</span>
              </label>
              <div className="mt-[18px] flex flex-wrap gap-2.5">
                <button
                  className={dangerButtonClass}
                  disabled={busy}
                  onClick={() => {
                    void onDelete();
                  }}
                  type="button"
                >
                  {copy.deleteAccount.deleteButton}
                </button>
                <Link className={textButtonClass} to="/settings">
                  {copy.deleteAccount.cancel}
                </Link>
              </div>
              {deleteError === null ? null : (
                <p className="mt-3 text-[12.5px] leading-[1.5] text-need" role="alert">
                  {deleteError}
                </p>
              )}
            </div>
          </section>
        </div>

        {erasing ? (
          <>
            <div ref={erasingRef}>
              <p className={stepClass}>{copy.deleteAccount.steps.erasing}</p>
              <section
                aria-labelledby="delete-erasing-heading"
                className={cardClass}
                data-testid="delete-erasing"
              >
                <h2 className={headingClass} id="delete-erasing-heading">
                  {copy.deleteAccount.erasingHeading}
                </h2>
                <output className="mt-3 block">
                  <span className="flex w-fit items-center gap-1.5 rounded-full bg-need-soft px-2.5 py-0.5 text-[11.5px] font-semibold leading-[normal] text-need">
                    {copy.deleteAccount.erasingPill}
                  </span>
                  <p className="mt-[14px] text-[12.5px] leading-[1.5] text-muted-foreground">
                    {copy.deleteAccount.erasingBody}
                  </p>
                </output>
              </section>
            </div>

            <div>
              <p className={stepClass}>{copy.deleteAccount.steps.email}</p>
              <DeleteEmailCard name={firstName} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
