import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { BadgeTone } from "./ui/badge.tsx";
import { CardHeader } from "./ui/card-header.tsx";
import { CardTitle } from "./ui/card-title.tsx";
import { Card } from "./ui/card.tsx";
import type { LaunchReadiness } from "../../lib/admin-api.ts";
import { saveSetting } from "../../lib/admin-api.ts";
import { useInvalidateAdminQueries } from "../../lib/admin-resource.ts";
import { ReadinessPresetRow } from "./readiness-preset-row.tsx";
import { ReadinessRow } from "./readiness-row.tsx";

const DAILY_CAP_PRESETS = [5, 10, 20] as const;
const CONCURRENCY_PRESETS = [0, 1, 3, 5] as const;

interface BadgeSpec {
  label: string;
  tone: BadgeTone;
}

function stripeBadge(mode: LaunchReadiness["stripeMode"]) {
  if (mode === "live") {
    const spec: BadgeSpec = { label: copy.admin.readinessStatusLive, tone: "ok" };

    return spec;
  }

  if (mode === "test") {
    const spec: BadgeSpec = { label: copy.admin.readinessStatusTest, tone: "signal" };

    return spec;
  }

  const spec: BadgeSpec = { label: copy.admin.readinessStatusOff, tone: "neutral" };

  return spec;
}

function costGateBadge(costGate: LaunchReadiness["costGate"]) {
  if (costGate.completed === 0 || costGate.costGateMet === null) {
    const spec: BadgeSpec = { label: copy.admin.readinessStatusPending, tone: "neutral" };

    return spec;
  }

  if (costGate.costGateMet) {
    const spec: BadgeSpec = { label: copy.admin.readinessStatusMet, tone: "ok" };

    return spec;
  }

  const spec: BadgeSpec = { label: copy.admin.readinessStatusOver, tone: "need" };

  return spec;
}

export function LaunchReadinessCard({
  allowQuickActions = false,
  readiness,
}: {
  allowQuickActions?: boolean;
  readiness: LaunchReadiness;
}) {
  const invalidateAdmin = useInvalidateAdminQueries();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const applyPreset = async (settingKey: string, value: number) => {
    setBusy(true);
    setSaveError(false);

    try {
      await saveSetting(settingKey, String(value));
      invalidateAdmin();
    } catch {
      setSaveError(true);
    }

    setBusy(false);
  };

  const stripe = stripeBadge(readiness.stripeMode);
  const cost = costGateBadge(readiness.costGate);

  const costDetail =
    readiness.costGate.costMicrosPerCompleted === null
      ? undefined
      : copy.admin.overviewCostGate(
          `$${(readiness.costGate.costMicrosPerCompleted / 1_000_000).toFixed(4)}`,
          `$${(readiness.costGate.costGateMicros / 1_000_000).toFixed(2)}`,
        );

  return (
    <Card ariaLabelledBy="admin-launch-readiness">
      <CardHeader>
        <CardTitle id="admin-launch-readiness">{copy.admin.readinessHeading}</CardTitle>
      </CardHeader>
      <p className="mt-1.5 text-xs text-muted-foreground">{copy.admin.readinessLead}</p>
      {saveError ? (
        <p className="mt-3 text-xs font-semibold text-need" role="alert">
          {copy.admin.readinessSaveError}
        </p>
      ) : null}
      <div className="mt-4">
        {allowQuickActions ? (
          <>
            <ReadinessPresetRow
              ariaFor={copy.admin.readinessPresetDailyAria}
              current={readiness.dailyCap}
              disabled={busy}
              label={copy.admin.readinessDailyCap}
              onSelect={(value) => {
                void applyPreset("limits.daily_cap", value);
              }}
              presets={DAILY_CAP_PRESETS}
              valueText={copy.admin.readinessDailyCapValue(readiness.dailyCap)}
            />
            <ReadinessPresetRow
              ariaFor={copy.admin.readinessPresetConcurrencyAria}
              current={readiness.browserConcurrency}
              disabled={busy}
              label={copy.admin.readinessBrowserConcurrency}
              labelFor={(value) => (value === 0 ? copy.admin.readinessPresetNoCap : String(value))}
              onSelect={(value) => {
                void applyPreset("browser.max_concurrent_sessions", value);
              }}
              presets={CONCURRENCY_PRESETS}
              valueText={copy.admin.readinessBrowserConcurrencyValue(readiness.browserConcurrency)}
            />
          </>
        ) : (
          <>
            <ReadinessRow
              badgeLabel={copy.admin.readinessDailyCapValue(readiness.dailyCap)}
              badgeTone="neutral"
              label={copy.admin.readinessDailyCap}
            />
            <ReadinessRow
              badgeLabel={copy.admin.readinessBrowserConcurrencyValue(readiness.browserConcurrency)}
              badgeTone="neutral"
              label={copy.admin.readinessBrowserConcurrency}
            />
          </>
        )}
        <ReadinessRow
          badgeLabel={
            readiness.publicSignupEnabled
              ? copy.admin.readinessStatusOn
              : copy.admin.readinessStatusInviteOnly
          }
          badgeTone={readiness.publicSignupEnabled ? "ok" : "neutral"}
          label={copy.admin.readinessPublicSignup}
        />
        <ReadinessRow
          badgeLabel={stripe.label}
          badgeTone={stripe.tone}
          label={copy.admin.readinessStripeMode}
        />
        <ReadinessRow
          badgeLabel={
            readiness.cfAccessConfigured
              ? copy.admin.readinessStatusConfigured
              : copy.admin.readinessStatusMissing
          }
          badgeTone={readiness.cfAccessConfigured ? "ok" : "need"}
          label={copy.admin.readinessCfAccess}
        />
        <ReadinessRow
          badgeLabel={
            readiness.alertNtfyConfigured
              ? copy.admin.readinessStatusConfigured
              : copy.admin.readinessStatusMissing
          }
          badgeTone={readiness.alertNtfyConfigured ? "ok" : "neutral"}
          label={copy.admin.readinessAlertNtfy}
        />
        <ReadinessRow
          badgeLabel={cost.label}
          badgeTone={cost.tone}
          detail={costDetail}
          label={copy.admin.readinessCostGate}
        />
      </div>
    </Card>
  );
}
