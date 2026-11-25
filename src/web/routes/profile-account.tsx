import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { AccountAdminCard } from "../components/account-admin-card.tsx";
import { AccountDeleteDialog } from "../components/account-delete-dialog.tsx";
import { AccountLegalCard } from "../components/account-legal-card.tsx";
import { AccountPacingCard } from "../components/account-pacing-card.tsx";
import { AccountSessionsCard } from "../components/account-sessions-card.tsx";
import { AccountSupportAccessCard } from "../components/account-support-access-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SettingsApplyEmailCard } from "../components/settings-apply-email-card.tsx";
import { SettingsCalendarFeed } from "../components/settings-calendar-feed.tsx";
import { SettingsForwardingCard } from "../components/settings-forwarding-card.tsx";
import { SettingsNotifications } from "../components/settings-notifications.tsx";
import { TimeLanguageSection } from "../components/time-language-section.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "../components/ui/ds.ts";
import { authClient } from "../lib/auth-client.ts";

export function ProfileAccountPage() {
  const { data: session } = authClient.useSession();
  const email = session === null ? "" : session.user.email;
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        titleNode={`${copy.nav.profilePages.accountTitlePlain}${copy.nav.profilePages.accountTitleItalic}`}
      />

      <AccountAdminCard />

      <section aria-labelledby="account-group-mail" className="flex flex-col gap-4">
        <h2 className={dsEyebrow} id="account-group-mail">
          {copy.settings.sectionGroups.mailboxHeading}
        </h2>
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2" id="forwarding">
          <SettingsForwardingCard />
          <SettingsApplyEmailCard />
        </div>
        <AccountPacingCard />
      </section>

      <section aria-labelledby="account-group-prefs" className="flex flex-col gap-4">
        <h2 className={dsEyebrow} id="account-group-prefs">
          {copy.settings.sectionGroups.preferencesHeading}
        </h2>
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-6">
            <SettingsNotifications />
          </div>
          <div className="flex min-w-0 flex-col gap-5 xl:col-span-6">
            <SettingsCalendarFeed />
            <TimeLanguageSection />
          </div>
        </div>
      </section>

      <section aria-labelledby="account-group-security" className="flex flex-col gap-4">
        <h2 className={dsEyebrow} id="account-group-security">
          {copy.settings.sectionGroups.securityHeading}
        </h2>
        <AccountSessionsCard email={email} />
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <AccountSupportAccessCard />
          <AccountLegalCard />
        </div>
      </section>

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

      <AccountDeleteDialog onOpenChange={setDeleteOpen} open={deleteOpen} />
    </div>
  );
}
