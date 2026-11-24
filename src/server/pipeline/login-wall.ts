/**
 * The preparation skip for a posting whose employer requires an account before
 * its application form can be seen (docs/SPEC.md §8.3). The value is written to
 * `applications.status_reason`, so Home shows it as Couldn't apply.
 */
export const LOGIN_WALL_REASON = "unsupported_login_required";

/** Why the pre-flight decided a posting is behind a mandatory login gate. */
export const LOGIN_WALL_MARKERS = [
  "redirect_path",
  "registration_path",
  "identity_provider",
  "login_query",
  "sign_in_copy",
  "password_field",
  "sign_in_form",
] as const;

export type LoginWallMarker = (typeof LOGIN_WALL_MARKERS)[number];

/** Where the detector saw the gate: the URL redirect, the page itself, or both. */
export type LoginWallSignal = "redirect" | "gate";

export interface LoginWallEvidence {
  signals: LoginWallSignal[];
  markers: LoginWallMarker[];
  url: string | null;
}

export type LoginWallVerdict = { wall: false } | { wall: true; evidence: LoginWallEvidence };

export interface LoginWallInput {
  requestedUrl: string;
  finalUrl?: string | null | undefined;
  html?: string | null | undefined;
}

/** A form read that stopped at a login gate instead of an application form. */
export interface LoginWallFormRead {
  loginWall: true;
  evidence: LoginWallEvidence;
}

const SIGN_IN_SEGMENTS: ReadonlySet<string> = new Set([
  "adfs",
  "auth",
  "authenticate",
  "authn",
  "idp",
  "log-in",
  "log_in",
  "login",
  "my-account",
  "myaccount",
  "oauth",
  "oauth2",
  "oidc",
  "openid",
  "saml",
  "saml2",
  "sign-in",
  "sign_in",
  "signin",
  "sign-on",
  "sign_on",
  "signon",
  "sso",
]);

const REGISTRATION_SEGMENTS: ReadonlySet<string> = new Set([
  "create-account",
  "create_account",
  "new-account",
  "register",
  "registration",
  "sign-up",
  "sign_up",
  "signup",
]);

const IDENTITY_HOSTS: readonly string[] = [
  "accounts.google.com",
  "auth0.com",
  "jumpcloud.com",
  "keycloak.org",
  "login.gov",
  "login.live.com",
  "login.microsoft.com",
  "login.microsoftonline.com",
  "okta.com",
  "oktapreview.com",
  "onelogin.com",
  "pingidentity.com",
  "pingone.com",
];

const IDENTITY_HOST_PREFIX = /^(?:adfs|auth|idp|login|saml|signin|sso)\./iu;

const SIGN_IN_QUERY_KEYS: ReadonlySet<string> = new Set([
  "action",
  "login",
  "mode",
  "requirelogin",
  "requireslogin",
  "showlogin",
  "sign-in",
  "sign_in",
  "signin",
  "sso",
]);

const STRONG_SIGN_IN_COPY: readonly RegExp[] = [
  /you (?:must|need to|have to) (?:be )?(?:sign|log)(?:ged|ed)? ?(?:in|on)\b/u,
  /(?:sign|log) ?(?:in|on) to continue\b/u,
  /(?:an?|your) account is required\b/u,
  /account required to (?:apply|continue)\b/u,
  /create an account to (?:apply|continue|start|complete|submit)\b/u,
  /must (?:have|create) an account (?:to|before)\b/u,
  /(?:sign|log) ?(?:in|on) or (?:register|sign up|create an account) to (?:apply|continue)\b/u,
];

const WEAK_SIGN_IN_COPY: readonly RegExp[] = [
  /(?:sign|log) ?(?:in|on) to (?:apply|start|complete|submit|access|view|see)\b/u,
  /register to apply\b/u,
  /(?:sign|log) ?(?:in|on) or (?:register|sign up|create an account)\b/u,
];

const OPTIONAL_SIGN_IN_COPY: readonly RegExp[] = [
  /(?:sign|log) ?(?:in|on) to (?:auto-?fill|pre-?fill|fill|speed up|save|import|use)\b/u,
  /(?:sign|log) ?(?:in|on) to (?:save|track) your (?:application|progress)\b/u,
  /(?:sign|log) ?(?:in|on) (?:with|using) (?:linkedin|indeed|google|microsoft|facebook|apple)\b/u,
  /apply with (?:linkedin|indeed|google)\b/u,
  /(?:continue|apply) with (?:linkedin|indeed)\b/u,
];

const NAME_FIELD =
  /(?:^|[^a-z])(?:first|last|full|given|family|candidate|applicant)?[-_ ]?name(?:$|[^a-z])/iu;

const NAME_AUTOCOMPLETE: ReadonlySet<string> = new Set(["family-name", "given-name", "name"]);

const EMAIL_FIELD = /e-?mail/iu;

const PHONE_FIELD = /phone|mobile|cell/iu;

const SIGN_IN_FORM = /(?:sign|log)[-_ ]?(?:in|on)|auth|session|sso/iu;

const APPLICATION_FORM = /apply|application/iu;

const BARE_PATH_EXTENSION = /\.(?:aspx?|html?|php|jsp|xhtml)$/gu;

const WHITESPACE = /\s+/gu;

const MAX_SCANNED_HTML_CHARS = 512_000;

interface ScannedInput {
  autocomplete: string;
  name: string;
  type: string;
}

interface ScannedPage {
  optionalCopy: boolean;
  password: boolean;
  signInForm: boolean;
  strongCopy: boolean;
  strongGuestForm: boolean;
  weakCopy: boolean;
  weakGuestForm: boolean;
}

interface RedirectGate {
  marker: LoginWallMarker;
  url: string;
}

function parsedUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalisedUrl(value: string) {
  const url = parsedUrl(value);

  if (url === null) {
    return value.trim();
  }

  url.hash = "";
  url.pathname = url.pathname.replaceAll(/\/+$/gu, "");

  return url.toString();
}

function pathSegments(pathname: string) {
  return pathname
    .toLowerCase()
    .replaceAll(/\/+$/gu, "")
    .replaceAll(BARE_PATH_EXTENSION, "")
    .split("/")
    .filter((segment) => segment !== "");
}

function hostMatches(hostname: string, identityHost: string) {
  const host = hostname.toLowerCase();

  return host === identityHost || host.endsWith(`.${identityHost}`);
}

function isIdentityHost(hostname: string) {
  return (
    IDENTITY_HOSTS.some((host) => hostMatches(hostname, host)) ||
    IDENTITY_HOST_PREFIX.test(hostname)
  );
}

function queryGate(search: string) {
  const params = new URLSearchParams(search);

  for (const [key, value] of params) {
    const name = key.toLowerCase();

    if (!SIGN_IN_QUERY_KEYS.has(name)) {
      continue;
    }

    const answered = value.toLowerCase();

    if (name === "action" || name === "mode") {
      if (answered === "login" || answered === "signin" || answered === "sign_in") {
        return true;
      }

      continue;
    }

    if (answered === "" || answered === "1" || answered === "true" || answered === "yes") {
      return true;
    }
  }

  return false;
}

function redirectGate(requestedUrl: string, finalUrl: string | null) {
  if (finalUrl === null || finalUrl.trim() === "") {
    return null;
  }

  const final = parsedUrl(finalUrl);

  if (final === null) {
    return null;
  }

  if (normalisedUrl(requestedUrl) === normalisedUrl(finalUrl)) {
    return null;
  }

  const segments = pathSegments(final.pathname);

  if (segments.some((segment) => SIGN_IN_SEGMENTS.has(segment))) {
    return { marker: "redirect_path", url: final.toString() } satisfies RedirectGate;
  }

  if (segments.some((segment) => REGISTRATION_SEGMENTS.has(segment))) {
    return { marker: "registration_path", url: final.toString() } satisfies RedirectGate;
  }

  if (isIdentityHost(final.hostname)) {
    return { marker: "identity_provider", url: final.toString() } satisfies RedirectGate;
  }

  if (queryGate(final.search)) {
    return { marker: "login_query", url: final.toString() } satisfies RedirectGate;
  }

  return null;
}

function scanPage(source: string) {
  const html = source.slice(0, MAX_SCANNED_HTML_CHARS);
  const inputs: ScannedInput[] = [];
  const forms: string[] = [];
  const visible: string[] = [];
  let textareas = 0;
  let hidden = 0;

  new HTMLRewriter()
    .on("script, style, template, noscript", {
      element(element) {
        hidden += 1;

        element.onEndTag(() => {
          hidden -= 1;
        });
      },
    })
    .on("input", {
      element(element) {
        inputs.push({
          autocomplete: (element.getAttribute("autocomplete") ?? "").toLowerCase(),
          name: `${element.getAttribute("name") ?? ""} ${element.getAttribute("id") ?? ""}`.trim(),
          type: (element.getAttribute("type") ?? "text").toLowerCase(),
        });
      },
    })
    .on("textarea", {
      element() {
        textareas += 1;
      },
    })
    .on("form", {
      element(element) {
        forms.push(
          [
            element.getAttribute("action"),
            element.getAttribute("id"),
            element.getAttribute("class"),
            element.getAttribute("name"),
          ]
            .filter((value) => value !== null)
            .join(" ")
            .toLowerCase(),
        );
      },
    })
    .onDocument({
      text(chunk) {
        if (hidden === 0) {
          visible.push(chunk.text);
        }
      },
    })
    .transform(html);

  const text = visible.join(" ").replaceAll(WHITESPACE, " ").trim().toLowerCase();

  const hasFile = inputs.some((input) => input.type === "file");
  const hasPassword = inputs.some((input) => input.type === "password");
  const hasEmail = inputs.some((input) => input.type === "email" || EMAIL_FIELD.test(input.name));
  const hasPhone = inputs.some((input) => input.type === "tel" || PHONE_FIELD.test(input.name));

  const hasName = inputs.some(
    (input) => NAME_AUTOCOMPLETE.has(input.autocomplete) || NAME_FIELD.test(input.name),
  );

  const applicationForm = forms.some((marker) => APPLICATION_FORM.test(marker));
  const identityFields = hasEmail && (hasName || hasPhone || hasFile || textareas > 0);

  return {
    optionalCopy: OPTIONAL_SIGN_IN_COPY.some((pattern) => pattern.test(text)),
    password: hasPassword,
    signInForm: forms.some((marker) => SIGN_IN_FORM.test(marker)),
    strongCopy: STRONG_SIGN_IN_COPY.some((pattern) => pattern.test(text)),
    strongGuestForm:
      (hasFile && (hasEmail || hasName || hasPhone)) || (applicationForm && identityFields),
    weakCopy: WEAK_SIGN_IN_COPY.some((pattern) => pattern.test(text)),
    weakGuestForm: identityFields && !hasPassword,
  } satisfies ScannedPage;
}

function gateMarkers(page: ScannedPage) {
  const markers: LoginWallMarker[] = [];

  if (page.strongGuestForm) {
    return markers;
  }

  const gated =
    page.strongCopy ||
    (!page.weakGuestForm &&
      !page.optionalCopy &&
      (page.weakCopy || page.password || page.signInForm));

  if (!gated) {
    return markers;
  }

  if (page.strongCopy || page.weakCopy) {
    markers.push("sign_in_copy");
  }

  if (page.password) {
    markers.push("password_field");
  }

  if (page.signInForm) {
    markers.push("sign_in_form");
  }

  return markers;
}

/**
 * Decides, without a browser and without a model, whether a posting sits behind
 * a mandatory login wall (docs/SPEC.md §8.3). It reads the URL a fetch settled
 * on, and the page itself, and returns why it is gated so preparation can skip
 * the Application as `unsupported_login_required` before any spend.
 *
 * The detector is deliberately conservative: a page that shows a guest
 * application form is never a wall, even when it also offers "Sign in to
 * autofill" or "Apply with LinkedIn", and an optional sign-in prompt alone is
 * never a wall.
 *
 * @param input the requested URL, the URL a fetch or browser settled on, and the page HTML
 * @returns whether the posting is behind a mandatory login gate, with the evidence
 */
export function detectLoginWall(input: LoginWallInput) {
  const signals: LoginWallSignal[] = [];
  const markers: LoginWallMarker[] = [];
  let url: string | null = null;

  const html = input.html ?? "";
  const page = html.trim() === "" ? null : scanPage(html);

  if (page?.strongGuestForm === true) {
    return { wall: false } satisfies LoginWallVerdict;
  }

  const redirect = redirectGate(input.requestedUrl, input.finalUrl ?? null);

  if (redirect !== null) {
    const { marker, url: redirectUrl } = redirect;

    signals.push("redirect");
    markers.push(marker);
    url = redirectUrl;
  }

  if (page !== null) {
    const gate = gateMarkers(page);

    if (gate.length > 0) {
      signals.push("gate");

      for (const marker of gate) {
        markers.push(marker);
      }

      url ??= input.finalUrl ?? input.requestedUrl;
    }
  }

  if (markers.length === 0) {
    return { wall: false } satisfies LoginWallVerdict;
  }

  return {
    wall: true,
    evidence: { markers, signals, url } satisfies LoginWallEvidence,
  } satisfies LoginWallVerdict;
}
