import type { AdminAuditRow } from "./types.ts";

import { env } from "../../config/env.ts";
import { logError } from "../log.ts";

const LOKI_PUSH_TIMEOUT_MS = 2000;

export interface LokiAuditConfig {
  url: string;
  job: string;
  service: string;
  environment: string;
  authToken: string | null;
  tenantId: string | null;
}

export function lokiAuditConfig() {
  if (env.LOKI_URL === undefined) {
    return null;
  }

  return {
    url: env.LOKI_URL.replace(/\/+$/u, ""),
    job: env.LOKI_AUDIT_JOB,
    service: env.LOKI_SERVICE_NAME,
    environment: env.NODE_ENV,
    authToken: env.LOKI_AUTH_TOKEN ?? null,
    tenantId: env.LOKI_TENANT_ID ?? null,
  } satisfies LokiAuditConfig;
}

function lokiHeaders(config: LokiAuditConfig) {
  const headers = new Headers({ "content-type": "application/json" });

  if (config.authToken !== null) {
    headers.set("authorization", `Bearer ${config.authToken}`);
  }

  if (config.tenantId !== null) {
    headers.set("x-scope-orgid", config.tenantId);
  }

  return headers;
}

function pushBody(config: LokiAuditConfig, row: AdminAuditRow) {
  const line = {
    action: row.action,
    actorId: row.actorId,
    at: row.at.getTime(),
    detailKeys: Object.keys(row.detail).toSorted(),
    id: row.id,
    reason: row.reason,
    targetUserId: row.targetUserId,
  };

  return {
    streams: [
      {
        stream: {
          environment: config.environment,
          job: config.job,
          service: config.service,
        },
        values: [[String(row.at.getTime() * 1_000_000), JSON.stringify(line)]],
      },
    ],
  };
}

export async function shipAuditToLoki(config: LokiAuditConfig, row: AdminAuditRow) {
  try {
    const response = await fetch(`${config.url}/loki/api/v1/push`, {
      body: JSON.stringify(pushBody(config, row)),
      headers: lokiHeaders(config),
      method: "POST",
      signal: AbortSignal.timeout(LOKI_PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logError("audit.loki", new Error(`Loki answered ${String(response.status)}`));
    }
  } catch (error) {
    logError("audit.loki", error);
  }
}
