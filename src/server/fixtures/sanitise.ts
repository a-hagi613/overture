import { createHash } from "node:crypto";

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/giu;

const EVENT_ATTRIBUTE = /\son[a-z]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const DATA_ATTRIBUTE = /\sdata-[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const NONCE_ATTRIBUTE = /\snonce(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const INTEGRITY_ATTRIBUTE = /\sintegrity(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const CROSSORIGIN_ATTRIBUTE = /\scrossorigin(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const SRCSET_ATTRIBUTE = /\ssrcset(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/giu;

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;

const URL_ATTRIBUTE =
  /(?<prefix>\s(?:href|src|action)\s*=\s*)(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))/giu;

const TRACKING_PARAMETER =
  /^(?:utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|gh_src|lever-source|ashby_source|ref|referrer|source|_ga|_gl)$/iu;

const TOKEN_INPUT =
  /<input\b[^>]*\bname\s*=\s*["']?(?:authenticity_token|csrf(?:token)?|_token|token)["']?[^>]*>/giu;

const VALUE_ATTRIBUTE = /\svalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu;

const AUTOCOMPLETE_ATTRIBUTE = /\sautocomplete\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu;

const FILLED_INPUT =
  /<input\b(?![^>]*\btype\s*=\s*["']?(?:hidden|submit|button|checkbox|radio|file)["']?)[^>]*>/giu;

const TEXTAREA = /<textarea\b(?<open>[^>]*)>[\s\S]*?<\/textarea>/giu;

const CSRF_META = /<meta\b[^>]*\bname\s*=\s*["']csrf-token["'][^>]*>/giu;

const FIELD_NAME = /\bname\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))/giu;

const FORM_ACTION = /\baction\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/iu;

const ASSET_EXTENSIONS = {
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
  "application/javascript": "js",
  "application/json": "json",
  "font/otf": "otf",
  "font/ttf": "ttf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/css": "css",
  "text/javascript": "js",
} as const satisfies Record<string, string>;

export function assetExtension(contentType: string, url: string) {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const fromType = Object.entries(ASSET_EXTENSIONS).find(([mime]) => mime === type)?.[1];

  if (fromType !== undefined) {
    return fromType;
  }

  const fromUrl = /\.(?<extension>[a-z0-9]{1,8})(?:$|[?#])/iu.exec(url)?.groups?.extension;

  return fromUrl?.toLowerCase() ?? "bin";
}

function sanitisedUrl(raw: string) {
  try {
    const url = new URL(raw, "https://fixture.invalid");
    const keys: string[] = [];

    for (const key of url.searchParams.keys()) {
      keys.push(key);
    }

    for (const key of keys) {
      if (TRACKING_PARAMETER.test(key)) {
        url.searchParams.delete(key);
      }
    }

    return raw.startsWith("/") ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    return raw;
  }
}

export function sanitiseFormHtml(html: string) {
  const stripped = html
    .replaceAll(SCRIPT_BLOCK, "")
    .replaceAll(TOKEN_INPUT, "")
    .replaceAll(EVENT_ATTRIBUTE, "")
    .replaceAll(DATA_ATTRIBUTE, "")
    .replaceAll(NONCE_ATTRIBUTE, "")
    .replaceAll(INTEGRITY_ATTRIBUTE, "")
    .replaceAll(CROSSORIGIN_ATTRIBUTE, "")
    .replaceAll(SRCSET_ATTRIBUTE, "")
    .replaceAll(FILLED_INPUT, (tag) =>
      tag.replaceAll(VALUE_ATTRIBUTE, ' value=""').replaceAll(AUTOCOMPLETE_ATTRIBUTE, ""),
    )
    .replaceAll(TEXTAREA, "<textarea$<open>></textarea>")
    .replaceAll(EMAIL, "applicant@example.invalid")
    .replaceAll(CSRF_META, '<meta name="csrf-token" content="" />');

  return stripped.replaceAll(
    URL_ATTRIBUTE,
    (_match, prefix: string, double?: string, single?: string, bare?: string) =>
      `${prefix}"${sanitisedUrl(double ?? single ?? bare ?? "")}"`,
  );
}

export function formSignature(html: string) {
  const names = [...html.matchAll(FIELD_NAME)]
    .flatMap((match) => {
      const name = match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? "";

      return name.length > 0 ? [name] : [];
    })
    .toSorted();

  const action = FORM_ACTION.exec(html);

  return createHash("sha256")
    .update(`${action?.groups?.double ?? action?.groups?.single ?? ""}\n${names.join("\n")}`)
    .digest("hex")
    .slice(0, 16);
}
