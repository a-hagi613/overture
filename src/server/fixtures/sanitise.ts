import { createHash } from "node:crypto";

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;

const TRACKING_PARAMETER =
  /^(?:utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|gh_src|lever-source|ashby_source|ref|referrer|source|_ga|_gl)$/iu;

const TOKEN_NAME = /^(?:authenticity_token|csrf(?:token)?|_token|token)$/iu;

const FILLED_INPUT_TYPES = new Set([
  "date",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

const URL_ATTRIBUTES = new Set(["action", "href", "src"]);

const DROPPED_PREFIXES = ["data-", "on"];

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

const FIELD_NAME = /\bname\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))/giu;

const FORM_ACTION = /\baction\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/iu;

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

function isDroppedAttribute(name: string) {
  const lower = name.toLowerCase();

  return (
    lower === "nonce" ||
    lower === "integrity" ||
    lower === "crossorigin" ||
    DROPPED_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function sanitiseFormHtml(html: string) {
  const rewriter = new HTMLRewriter()
    .on("script", {
      element(element) {
        element.remove();
      },
    })
    .on("textarea", {
      element(element) {
        element.setInnerContent("");
      },
    })
    .on("meta", {
      element(element) {
        const name = element.getAttribute("name") ?? "";

        if (/nonce|token/iu.test(name)) {
          element.setAttribute("content", "");
        }
      },
    })
    .on("input", {
      element(element) {
        const name = element.getAttribute("name") ?? "";

        if (TOKEN_NAME.test(name)) {
          element.remove();

          return;
        }

        const type = (element.getAttribute("type") ?? "text").toLowerCase();

        if (FILLED_INPUT_TYPES.has(type)) {
          element.setAttribute("value", "");
        }

        element.removeAttribute("autocomplete");
      },
    })
    .onDocument({
      text(text) {
        text.replace(text.text.replaceAll("<", "&lt;"), { html: true });
      },
    })
    .on("*", {
      element(element) {
        if (element.tagName.includes("<")) {
          element.remove();

          return;
        }

        const names: string[] = [];

        for (const [name] of element.attributes) {
          names.push(name);
        }

        for (const name of names) {
          if (isDroppedAttribute(name)) {
            element.removeAttribute(name);
          } else if (URL_ATTRIBUTES.has(name.toLowerCase())) {
            element.setAttribute(name, sanitisedUrl(element.getAttribute(name) ?? ""));
          }
        }
      },
    });

  return rewriter.transform(html).replaceAll(EMAIL, "applicant@example.invalid");
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
