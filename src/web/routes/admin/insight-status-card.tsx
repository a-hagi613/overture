import { copy } from "../../../shared/copy.ts";
import type { AdminUserInsight } from "../../lib/admin-api.ts";
import { adminDay, adminDayTime } from "../../lib/admin-date.ts";
import { AdminAccountItem } from "./account-item.tsx";
import { insightCardClass } from "./insight-card-class.ts";
import { PresencePill } from "./insight-presence-pill.tsx";

export function InsightStatusCard({ insight, now }: { insight: AdminUserInsight; now: number }) {
  const { onboarding, presence } = insight;

  return (
    <section aria-labelledby="admin-user-status" className={insightCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-card-title leading-[1.1]" id="admin-user-status">
          {copy.admin.insightStatusHeading}
        </h2>
        <PresencePill online={presence.online} />
      </div>
      <dl className="mt-3">
        <AdminAccountItem label={copy.admin.insightLastSeen}>
          {presence.lastSeenAt === null
            ? copy.admin.insightNotSeen
            : adminDayTime(presence.lastSeenAt, now)}
        </AdminAccountItem>
        <AdminAccountItem label={copy.admin.insightLastSignIn}>
          {presence.lastSignInAt === null
            ? copy.admin.lastActivityNever
            : adminDayTime(presence.lastSignInAt, now)}
        </AdminAccountItem>
        <AdminAccountItem label={copy.admin.insightSessions}>
          {String(presence.signedInSessions)}
        </AdminAccountItem>
        <AdminAccountItem label={copy.admin.insightOnboarding}>
          {onboarding.onboardedAt === null
            ? copy.admin.insightOnboardingStep(onboarding.step)
            : copy.admin.insightOnboardingDone(adminDay(onboarding.onboardedAt))}
        </AdminAccountItem>
        <AdminAccountItem label={copy.admin.insightRunning}>
          {onboarding.running
            ? copy.admin.insightRunningOn
            : copy.admin.insightRunningOff(onboarding.pauseReason)}
        </AdminAccountItem>
      </dl>
    </section>
  );
}
