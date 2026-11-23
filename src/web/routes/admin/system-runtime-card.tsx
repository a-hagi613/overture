import { copy } from "../../../shared/copy.ts";
import type { SystemReport } from "../../lib/admin-api.ts";
import { SystemPill } from "./system-pill.tsx";
import { SystemStat } from "./system-stat.tsx";

function backupLine(backups: SystemReport["backups"]) {
  if (backups.replication === "ok") {
    return copy.admin.systemLitestreamOk(backups.lagSeconds);
  }

  if (backups.replication === "unavailable") {
    return copy.admin.systemLitestreamUnavailable;
  }

  if (backups.replication === "unconfigured") {
    return copy.admin.systemLitestreamUnconfigured;
  }

  return copy.admin.systemLitestreamUnknown;
}

function backupTone(backups: SystemReport["backups"]) {
  if (backups.replication === "ok") {
    return "ok" as const;
  }

  return backups.replication === "unavailable" ? ("warn" as const) : ("neutral" as const);
}

function stripeValue(mode: SystemReport["integrations"]["stripeMode"]) {
  if (mode === "live") {
    return copy.admin.systemStripeLive;
  }

  return mode === "test" ? copy.admin.systemStripeTest : copy.admin.systemStripeUnconfigured;
}

function stripeTone(mode: SystemReport["integrations"]["stripeMode"]) {
  if (mode === "live") {
    return "ok" as const;
  }

  return mode === "test" ? ("warn" as const) : ("neutral" as const);
}

function configuredValue(configured: boolean) {
  return configured ? copy.admin.systemConfigured : copy.admin.systemNotConfigured;
}

function onOffValue(enabled: boolean) {
  return enabled ? copy.admin.systemOn : copy.admin.systemOff;
}

function integrationRows(view: SystemReport) {
  const { integrations } = view;

  return [
    {
      label: copy.admin.systemStripe,
      tone: stripeTone(integrations.stripeMode),
      value: stripeValue(integrations.stripeMode),
    },
    {
      label: copy.admin.systemCloudflareEmail,
      tone: integrations.cloudflareEmailConfigured ? ("ok" as const) : ("neutral" as const),
      value: configuredValue(integrations.cloudflareEmailConfigured),
    },
    {
      label: copy.admin.systemTurnstile,
      tone: integrations.turnstileConfigured ? ("ok" as const) : ("warn" as const),
      value: configuredValue(integrations.turnstileConfigured),
    },
    {
      label: copy.admin.systemBrowserProvider,
      tone: integrations.browserProvider === null ? ("neutral" as const) : ("ok" as const),
      value:
        integrations.browserProvider === null
          ? copy.admin.systemNotConfigured
          : copy.admin.reportBrowserName(integrations.browserProvider),
    },
    {
      label: copy.admin.systemNtfy,
      tone: integrations.ntfyConfigured ? ("ok" as const) : ("neutral" as const),
      value: configuredValue(integrations.ntfyConfigured),
    },
    {
      label: copy.admin.systemCfAccess,
      tone: integrations.cfAccessConfigured ? ("ok" as const) : ("neutral" as const),
      value: configuredValue(integrations.cfAccessConfigured),
    },
    {
      label: copy.admin.systemPublicSignup,
      tone: "neutral" as const,
      value: onOffValue(integrations.publicSignupEnabled),
    },
    {
      label: copy.admin.systemDemoLogin,
      tone: "neutral" as const,
      value: onOffValue(integrations.demoLoginEnabled),
    },
  ];
}

function degradedText(view: SystemReport) {
  if (view.degraded === null) {
    return copy.admin.systemDegradedClear;
  }

  const metrics = view.degraded.metrics
    .map(
      (metric) => `${metric.metric} at ${copy.admin.systemPercent(metric.used / metric.allowance)}`,
    )
    .join(", ");

  return copy.admin.systemDegradedNow(view.degraded.since, metrics);
}

export function SystemRuntimeCard({ view }: { view: SystemReport }) {
  return (
    <section
      aria-labelledby="admin-system-runtime"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-system-runtime">
        {copy.admin.systemRuntimeHeading}
      </h2>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
        <SystemStat
          label={copy.admin.systemMemoryRss}
          value={copy.admin.systemMegabytes(view.runtime.rssBytes)}
        />
        <SystemStat
          label={copy.admin.systemHeapUsed}
          value={copy.admin.systemMegabytes(view.runtime.heapUsedBytes)}
        />
        <SystemStat
          label={copy.admin.systemLoadAverage}
          value={copy.admin.systemLoad(view.runtime.loadAverage)}
        />
        <SystemStat
          label={copy.admin.systemUptime}
          value={copy.admin.systemUptimeValue(view.runtime.uptimeSeconds)}
        />
        <SystemStat label={copy.admin.systemBunVersion} value={view.runtime.bunVersion} />
      </dl>
      <p className="mt-5 flex flex-wrap items-center gap-2 text-[12.5px]">
        <SystemPill label={copy.admin.systemLitestream} tone={backupTone(view.backups)} />
        <span className="text-muted-foreground">{backupLine(view.backups)}</span>
      </p>
      <p className="mt-2 text-[12.5px] text-muted-foreground">{degradedText(view)}</p>
      <h3 className="mt-6 font-serif text-[19px] leading-[1.2]">
        {copy.admin.systemIntegrationsHeading}
      </h3>
      <ul className="mt-3 grid list-none grid-cols-1 gap-x-8 gap-y-0 p-0 sm:grid-cols-2">
        {integrationRows(view).map((row) => (
          <li
            className="flex min-w-0 items-center justify-between gap-3 border-t border-border py-2.5"
            key={row.label}
          >
            <span className="text-[12.5px] text-muted-foreground">{row.label}</span>
            <SystemPill label={row.value} tone={row.tone} />
          </li>
        ))}
      </ul>
    </section>
  );
}
