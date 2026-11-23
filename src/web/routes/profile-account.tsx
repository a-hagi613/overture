import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { AccountDeleteDialog } from "../components/account-delete-dialog.tsx";
import { AccountLegalCard } from "../components/account-legal-card.tsx";
import { AccountPacingCard } from "../components/account-pacing-card.tsx";
import { AccountSessionsCard } from "../components/account-sessions-card.tsx";
import { AccountSupportAccessCard } from "../components/account-support-access-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SettingsCalendarFeed } from "../components/settings-calendar-feed.tsx";
import { SettingsForwardingCard } from "../components/settings-forwarding-card.tsx";
import { SettingsNotifications } from "../components/settings-notifications.tsx";
import { TimeLanguageSection } from "../components/time-language-section.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { authClient } from "../lib/auth-client.ts";

export function ProfileAccountPage() {
  const { data: session } = authClient.useSession();
  const email = session === null ? "" : session.user.email;
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        lead={copy.nav.profilePages.accountLead}
        titleNode={
          <>
            {copy.nav.profilePages.accountTitlePlain}
            <em className="italic text-signal">{copy.nav.profilePages.accountTitleItalic}</em>
          </>
        }
      />

      <div className="mt-6 flex flex-col gap-5">
        <div id="forwarding">
          <SettingsForwardingCard />
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <SettingsNotifications />

          <div className="flex flex-col gap-5">
            <SettingsCalendarFeed />
            <TimeLanguageSection />
            <AccountSessionsCard email={email} />
          </div>
        </div>

        <AccountPacingCard />

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <AccountSupportAccessCard />
          <AccountLegalCard />
        </div>

        <Card ariaLabelledBy="account-danger" className="border-need/40 p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className={dsCardTitle} id="account-danger">
                {copy.settings.dangerHeading}
              </h2>
              <p className={`${dsBody} mt-1`}>{copy.settings.deleteDetail}</p>
            </div>
            <Button
              className="self-start sm:self-auto"
              onClick={() => {
                setDeleteOpen(true);
              }}
              size="default"
              variant="destructive"
            >
              {copy.settings.deleteButton}
            </Button>
          </div>
        </Card>
      </div>

      <AccountDeleteDialog onOpenChange={setDeleteOpen} open={deleteOpen} />
    </div>
  );
}
