import type { NetworkPolicy, NetworkPolicyInput } from "./browser-use.ts";

import { BrowserUseApiError } from "./browser-use.ts";
import { CAPTCHA_HOSTS, TRACKER_HOSTS } from "./proxy-trim.ts";

/**
 * The name is the identity of our policy in the project: the resolver lists the
 * project's policies and updates this one instead of creating another, so a
 * restart or a second machine reuses it (a project holds at most 100 policies).
 */
export const NETWORK_POLICY_NAME = "overture-proxy-trim";

const POLICY_PAGE_SIZE = 100;

export interface ProxyTrimNetworkPolicy extends NetworkPolicyInput {
  name: string;
  defaultAction: "allow";
  allow: { domains: string[] };
  block: { domains: string[] };
}

/**
 * The proxy-level twin of `applySendProxyTrim`. A network policy decides by
 * domain, not by resource type, so it mirrors the tracker host list; fonts,
 * images and media stay a Playwright-only block because a domain policy cannot
 * tell a font or a logo from a script. CAPTCHA hosts are allowed explicitly and
 * removed from the block list, so a drift in the two lists can never lock a
 * solver out.
 * @returns The policy to create or keep up to date.
 */
export function proxyTrimNetworkPolicy() {
  const captchaHosts: readonly string[] = CAPTCHA_HOSTS;

  return {
    allow: { domains: [...CAPTCHA_HOSTS] },
    block: { domains: TRACKER_HOSTS.filter((host) => !captchaHosts.includes(host)) },
    defaultAction: "allow",
    name: NETWORK_POLICY_NAME,
  } satisfies ProxyTrimNetworkPolicy;
}

export interface NetworkPolicyClient {
  createNetworkPolicy: (input: NetworkPolicyInput) => Promise<NetworkPolicy>;
  listNetworkPolicies: (input?: {
    pageNumber?: number;
    pageSize?: number;
  }) => Promise<{ items: NetworkPolicy[] }>;
  updateNetworkPolicy: (policyId: string, input: NetworkPolicyInput) => Promise<NetworkPolicy>;
}

async function resolveNetworkPolicy(client: NetworkPolicyClient) {
  const wanted = proxyTrimNetworkPolicy();
  const listed = await client.listNetworkPolicies({ pageNumber: 1, pageSize: POLICY_PAGE_SIZE });
  const existing = listed.items.find((policy) => policy.name === wanted.name);

  if (existing === undefined) {
    return (await client.createNetworkPolicy(wanted)).id;
  }

  try {
    return (await client.updateNetworkPolicy(existing.id, wanted)).id;
  } catch (error) {
    if (error instanceof BrowserUseApiError && error.status === 404) {
      return (await client.createNetworkPolicy(wanted)).id;
    }

    throw error;
  }
}

/**
 * Resolves the project's proxy-trim policy once per process and keeps the
 * result. The returned promise is shared by concurrent sessions, and a failure
 * clears it so the next session tries again instead of caching the failure.
 * @param client The Browser Use client that owns the project.
 * @returns A function that yields the policy id.
 */
export function createNetworkPolicyResolver(client: NetworkPolicyClient) {
  let resolved: Promise<string> | null = null;

  return async function resolve() {
    if (resolved === null) {
      resolved = resolveNetworkPolicy(client);

      try {
        return await resolved;
      } catch (error) {
        resolved = null;

        throw error;
      }
    }

    return resolved;
  };
}
