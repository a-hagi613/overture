export function normalizeTitle(title: string) {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeApplyUrl(rawUrl: string) {
  let parsed: URL | undefined;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  parsed.hash = "";

  for (const paramKey of [...parsed.searchParams.keys()].filter(
    (candidate) => candidate === "gh_src" || candidate === "ref" || candidate.startsWith("utm_"),
  )) {
    parsed.searchParams.delete(paramKey);
  }

  const query = parsed.searchParams.toString();

  const pathname =
    parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/u, "") : parsed.pathname;

  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${query === "" ? "" : `?${query}`}`;
}
