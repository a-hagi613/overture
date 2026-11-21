import { Resolver, resolve } from "node:dns/promises";

export function createMailDnsResolver(server: string | undefined) {
  const resolver = server === undefined ? null : new Resolver({ timeout: 5000, tries: 2 });

  if (resolver !== null && server !== undefined) {
    resolver.setServers([server]);
  }

  return async (name: string, rrtype: string) => {
    if (rrtype !== "TXT") {
      return [];
    }

    const rows = resolver === null ? await resolve(name, "TXT") : await resolver.resolveTxt(name);

    if (name.includes("._domainkey.")) {
      return [rows.map((row) => row.join("")).join("")];
    }

    return rows;
  };
}
