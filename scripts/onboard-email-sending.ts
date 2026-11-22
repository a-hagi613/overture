import {
  CloudflareApiError,
  createSendingSubdomain,
  listSendingSubdomains,
  readEmailSendingReadiness,
  resolveZoneId,
} from "../src/server/platform/mail/sending-domain.ts";
import type {
  EmailSendingConfig,
  EmailSendingPlan,
  EmailSendingReadiness,
} from "../src/server/platform/mail/sending-domain.ts";
import { env } from "../src/server/config/env.ts";

const args = process.argv.slice(2);

function flagValue(name: string) {
  const index = args.indexOf(name);

  return index === -1 ? null : (args[index + 1] ?? null);
}

const dryRun = args.includes("--dry-run");
const checkOnly = args.includes("--check");
const zoneArgument = flagValue("--zone");
const domainArgument = flagValue("--domain");

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

function fail(line: string) {
  process.stderr.write(`${line}\n`);
}

function planLabel(plan: EmailSendingPlan) {
  if (plan === "entitled") {
    return "Workers Paid (Cloudflare Email Sending is entitled)";
  }

  if (plan === "not-entitled") {
    return "not entitled (Workers Paid or the Email Sending entitlement is missing)";
  }

  return "unknown (Cloudflare Email Sending could not be read)";
}

function readinessLine(readiness: EmailSendingReadiness) {
  if (!readiness.onboarded) {
    return "not onboarded";
  }

  if (!readiness.enabled) {
    return "onboarded, sending disabled";
  }

  return readiness.ready ? "onboarded, records verified" : "onboarded, records not verified";
}

function printReadiness(readiness: EmailSendingReadiness) {
  write(`plan: ${planLabel(readiness.plan)}`);
  write(`domain: ${readiness.domain} (${readinessLine(readiness)})`);

  if (readiness.returnPathDomain !== null) {
    write(`return-path: ${readiness.returnPathDomain}`);
  }

  if (readiness.dkimSelector !== null) {
    write(`DKIM selector: ${readiness.dkimSelector}`);
  }

  for (const record of readiness.records) {
    write(
      `  ${record.kind.padEnd(5)} ${record.name} ${record.ok ? "ok" : "MISSING"} (${record.detail})`,
    );
  }

  if (!readiness.ready && readiness.receivedSummary !== undefined) {
    write(
      `received records: ${readiness.receivedSummary === "" ? "(none)" : readiness.receivedSummary}`,
    );
  }

  if (readiness.error !== null) {
    fail(`error: ${readiness.error}`);
  }
}

function printApexNote() {
  write(
    "apex Email Routing records: untouched (this script never writes zone DNS records; sending records live on cf-bounce)",
  );
}

async function check(config: EmailSendingConfig) {
  const readiness = await readEmailSendingReadiness(config);

  write(`Cloudflare Email Sending check for ${config.domain}`);
  printReadiness(readiness);
  printApexNote();
  write(
    readiness.ready
      ? "verdict: ready; a send to any recipient is allowed"
      : "verdict: not ready; the deploy guard refuses while REQUIRE_EMAIL_SENDING is on",
  );

  return readiness.ready ? 0 : 1;
}

async function onboard(config: EmailSendingConfig) {
  write(`Cloudflare Email Sending onboarding for ${config.domain}`);

  let zoneId: string;

  try {
    zoneId = await resolveZoneId(config);
  } catch (error) {
    const plan: EmailSendingPlan =
      error instanceof CloudflareApiError && error.status === 403 ? "not-entitled" : "unknown";

    write(`plan: ${planLabel(plan)}`);
    fail(`error: ${error instanceof Error ? error.message : String(error)}`);

    return 1;
  }

  write(`zone: ${zoneId}`);

  let subdomains;

  try {
    subdomains = await listSendingSubdomains(config, zoneId);
  } catch (error) {
    const plan: EmailSendingPlan =
      error instanceof CloudflareApiError && error.status === 403 ? "not-entitled" : "unknown";

    write(`plan: ${planLabel(plan)}`);
    fail(`error: ${error instanceof Error ? error.message : String(error)}`);

    if (plan === "not-entitled") {
      fail(
        "pay for Workers Paid on the account that owns the domain, then run this script again (docs/DEPLOY.md, M2-02)",
      );
    }

    return 1;
  }

  const existing = subdomains.find((entry) => entry.name === config.domain);
  const needsCreate = existing === undefined || !existing.enabled;

  write(`plan: ${planLabel("entitled")}`);

  if (!needsCreate) {
    write("action: none (already onboarded and enabled)");
  }

  if (needsCreate && dryRun) {
    write(
      existing === undefined
        ? "action: would onboard the domain; Cloudflare would add bounce MX, SPF and DKIM on cf-bounce and, when no DMARC record exists, one DMARC record (dry run: no write request was sent)"
        : "action: would re-enable Email Sending on the existing subdomain (dry run: no write request was sent)",
    );
  }

  if (needsCreate && !dryRun) {
    try {
      await createSendingSubdomain(config, zoneId, config.domain);
    } catch (error) {
      fail(`error: ${error instanceof Error ? error.message : String(error)}`);

      return 1;
    }

    write(
      existing === undefined
        ? `action: onboarded ${config.domain}; Cloudflare added the sending records on cf-bounce`
        : "action: re-enabled Email Sending on the existing subdomain",
    );
  }

  if (dryRun) {
    const readiness = await readEmailSendingReadiness({ ...config, zoneId });

    printReadiness(readiness);
    printApexNote();
    write("verdict: dry run finished; no write request was sent");

    return readiness.plan === "not-entitled" ? 1 : 0;
  }

  const readiness = await readEmailSendingReadiness({ ...config, zoneId });

  printReadiness(readiness);
  printApexNote();
  write(
    readiness.ready
      ? "verdict: verified; every required record is present and a send to any recipient is allowed"
      : "verdict: not ready; run the script again after DNS propagates",
  );

  return readiness.ready ? 0 : 1;
}

async function main() {
  if (env.CLOUDFLARE_EMAIL_API_TOKEN === undefined) {
    fail("set CLOUDFLARE_EMAIL_API_TOKEN in the environment before onboarding the sending domain.");
    process.exitCode = 1;

    return;
  }

  const config: EmailSendingConfig = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? null,
    zoneId: zoneArgument ?? env.CLOUDFLARE_ZONE_ID ?? null,
    apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
    baseUrl: env.CLOUDFLARE_EMAIL_API_BASE_URL,
    domain: domainArgument ?? env.MAIL_DOMAIN,
  };

  process.exitCode = checkOnly ? await check(config) : await onboard(config);
}

await main();
