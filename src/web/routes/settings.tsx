import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { AccountRow } from "../components/account-row.tsx";
import { LimitRow } from "../components/limit-row.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SettingsLegal } from "../components/settings-legal.tsx";
import { TimeLanguageSection } from "../components/time-language-section.tsx";
import { authClient } from "../lib/auth-client.ts";

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const email = session === null ? "" : session.user.email;
  const navigate = useNavigate();
  const [signedOutOthers, setSignedOutOthers] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const revokeOthers = async () => {
    const result = await authClient.revokeOtherSessions();

    if (result.error === null) {
      setSignedOutOthers(true);
    }
  };

  const signOutHere = async () => {
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      const result = await authClient.signOut();

      if (result.error === null) {
        await navigate("/signin");

        return;
      }
    } catch {
      setSignOutFailed(true);
    }

    setSigningOut(false);
    setSignOutFailed(true);
  };

  return (
    <div className="mx-auto max-w-[940px]">
      <PageHeader
        lead={copy.settings.lead}
        titleNode={
          <>
            {copy.settings.titlePlain} <span className="italic">{copy.settings.titleItalic}</span>
          </>
        }
      />
      <div className="mt-7 grid grid-cols-1 items-start gap-5 min-[900px]:grid-cols-2">
        <section
          aria-labelledby="settings-limits"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <div>
            <h2 id="settings-limits" className="font-serif text-[26px] leading-[1.1]">
              {copy.settings.limitsHeadingPlain}{" "}
              <span className="italic">{copy.settings.limitsHeadingItalic}</span>
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.limitsIntro}</p>
          <div className="mt-4">
            <LimitRow detail={copy.settings.limitDailyDetail} label={copy.settings.limitDaily} />
            <LimitRow detail={copy.settings.limitWindowDetail} label={copy.settings.limitWindow} />
            <LimitRow
              detail={copy.settings.limitCompanyDetail}
              label={copy.settings.limitCompany}
            />
            <LimitRow detail={copy.settings.limitRepostDetail} label={copy.settings.limitRepost} />
          </div>
          <p className="mt-2 border-t border-border pt-3.5 text-[12.5px] text-muted-foreground">
            {copy.settings.limitsFixed}
          </p>
        </section>
        <TimeLanguageSection />
        <SettingsLegal />
        <section
          aria-labelledby="settings-account"
          className="rounded-lg border border-border bg-card p-[22px_24px_10px] shadow-sh min-[900px]:col-span-2"
        >
          <div>
            <h2 id="settings-account" className="font-serif text-[26px] leading-[1.1]">
              {copy.settings.accountHeading}
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{email}</p>
          <div className="mt-2.5">
            <AccountRow label={copy.signIn.google} detail={copy.settings.providerNote} />
            <AccountRow label={copy.signIn.linkedin} detail={copy.settings.providerNote} />
            <AccountRow
              label={copy.settings.magicLinkTitle}
              detail={copy.settings.magicLinkDetail}
            />
            <AccountRow
              label={copy.settings.jobSearchAddress}
              detail={copy.settings.addressDetail}
            />
            <div className="flex items-center justify-between gap-4 border-t border-border py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{copy.settings.exportRow}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {copy.settings.exportRowDetail}
                </p>
              </div>
              <Link
                className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted"
                to="/settings/export"
              >
                {copy.settings.exportRowButton}
              </Link>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{copy.settings.signOutThis}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {copy.settings.signOutThisDetail}
                </p>
                {signOutFailed ? (
                  <p className="mt-1.5 text-[12.5px] leading-[1.5] text-need" role="alert">
                    {copy.settings.signOutThisError}
                  </p>
                ) : null}
              </div>
              <button
                aria-busy={signingOut}
                className="inline-flex min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={signingOut}
                onClick={() => {
                  void signOutHere();
                }}
                type="button"
              >
                {signingOut ? copy.settings.signOutThisPending : copy.settings.signOutThisButton}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{copy.settings.signOutAll}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {signedOutOthers
                    ? copy.settings.signedOutMessage
                    : copy.settings.signOutAllDetail}
                </p>
              </div>
              <button
                className="inline-flex min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                onClick={() => {
                  void revokeOthers();
                }}
                type="button"
              >
                {copy.settings.signOutAllButton}
              </button>
            </div>
          </div>
        </section>
        <section
          aria-labelledby="settings-danger"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh min-[900px]:col-span-2"
        >
          <h2 id="settings-danger" className="font-serif text-[26px] leading-[1.1]">
            {copy.settings.dangerHeading}
          </h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{copy.settings.deleteTitle}</p>
              <p className="text-[12.5px] text-muted-foreground">{copy.settings.deleteDetail}</p>
            </div>
            <Link
              className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-need bg-card px-[18px] text-[13.5px] font-semibold text-need hover:bg-need-soft"
              to="/settings/delete"
            >
              {copy.settings.deleteButton}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
