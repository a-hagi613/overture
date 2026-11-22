export const LAB_FORM_ATS = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

export type LabFormAts = (typeof LAB_FORM_ATS)[number];

export const LAB_CHALLENGE_PAGES = ["recaptcha_v3", "hcaptcha", "turnstile"] as const;

export type LabChallengePage = (typeof LAB_CHALLENGE_PAGES)[number];

export type LabRunPage = "form" | LabChallengePage;

export interface LabFormField {
  label: string;
  name: string;
  type: "email" | "file" | "text";
}

export const LAB_FORM_FIELDS = {
  ashby: [
    { label: "Name", name: "_systemfield_name", type: "text" },
    { label: "Email", name: "_systemfield_email", type: "email" },
    { label: "Resume", name: "_systemfield_resume", type: "file" },
  ],
  greenhouse: [
    { label: "First name", name: "first_name", type: "text" },
    { label: "Last name", name: "last_name", type: "text" },
    { label: "Email", name: "email", type: "email" },
    { label: "Resume/CV", name: "resume", type: "file" },
  ],
  lever: [
    { label: "Full name", name: "name", type: "text" },
    { label: "Email", name: "email", type: "email" },
    { label: "Resume/CV", name: "resume", type: "file" },
  ],
  personio: [
    { label: "First name", name: "first_name", type: "text" },
    { label: "Last name", name: "last_name", type: "text" },
    { label: "Email", name: "email", type: "email" },
    { label: "Resume", name: "documents.cv", type: "file" },
  ],
  workable: [
    { label: "First name", name: "firstname", type: "text" },
    { label: "Last name", name: "lastname", type: "text" },
    { label: "Email", name: "email", type: "email" },
    { label: "Resume", name: "resume", type: "file" },
  ],
} satisfies Record<LabFormAts, readonly LabFormField[]>;

export interface LabPageDefinition {
  key: string;
  page: LabRunPage;
  ats: LabFormAts | null;
  path: string;
  title: string;
}

const challengePages = [
  {
    key: "recaptcha_v3",
    page: "recaptcha_v3",
    ats: null,
    path: "/lab/recaptcha-v3",
    title: "reCAPTCHA v3",
  },
  { key: "hcaptcha", page: "hcaptcha", ats: null, path: "/lab/hcaptcha", title: "hCaptcha" },
  { key: "turnstile", page: "turnstile", ats: null, path: "/lab/turnstile", title: "Turnstile" },
] as const;

const formPages = LAB_FORM_ATS.map(
  (ats) =>
    ({
      ats,
      key: `form:${ats}`,
      page: "form",
      path: `/lab/forms/${ats}`,
      title: `Recorded ${ats} form`,
    }) satisfies LabPageDefinition,
);

export const LAB_PAGES: readonly LabPageDefinition[] = [...challengePages, ...formPages];

export const LAB_PAGE_KEYS = LAB_PAGES.map((definition) => definition.key);

export function labPage(key: string) {
  return LAB_PAGES.find((definition) => definition.key === key) ?? null;
}

export interface LabPageEnvironment {
  recaptchaScriptUrl: string;
  recaptchaSiteKey: string;
  hcaptchaScriptUrl: string;
  hcaptchaSiteKey: string;
  turnstileScriptUrl: string;
  turnstileSiteKey: string;
}

export type LabChallengeMode = "pass" | "blocked";

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

const shell = (input: {
  attributes?: string;
  body: string;
  page: LabRunPage;
  scripts: string[];
  title: string;
}) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overture lab — ${input.title}</title>
<link rel="stylesheet" href="/lab/lab.css">
${input.scripts.map((src) => `<script src="${escapeAttribute(src)}" defer></script>`).join("\n")}
<script src="/lab/lab.js" defer></script>
</head>
<body data-lab-page="${input.page}"${input.attributes === undefined ? "" : ` ${input.attributes}`}>
<main>
${input.body}
<p class="lab-note">This is an Overture lab page. No employer is involved.</p>
<p><a href="/lab">Back to the lab</a></p>
</main>
</body>
</html>
`;

const statusBlock = `<p id="lab-status" data-lab-status="waiting" role="status">Waiting for the challenge</p>
<p id="lab-score" data-lab-score="">No score yet</p>`;

function challengeBody(mode: LabChallengeMode, widget: string) {
  const blocked =
    mode === "blocked"
      ? `<p class="lab-blocked">This page is set to keep its challenge visible.</p>`
      : "";

  return `<h1>Challenge lab</h1>
<div id="lab-challenge" class="lab-challenge">${widget}</div>
${blocked}
${statusBlock}`;
}

export function renderReCaptchaPage(environment: LabPageEnvironment, mode: LabChallengeMode) {
  return shell({
    attributes: `data-lab-action="lab" data-lab-challenge="${mode}" data-lab-score-endpoint="/lab/recaptcha/score" data-lab-sitekey="${escapeAttribute(environment.recaptchaSiteKey)}"`,
    body: challengeBody(
      mode,
      `<div id="lab-recaptcha" data-sitekey="${escapeAttribute(environment.recaptchaSiteKey)}"></div>`,
    ),
    page: "recaptcha_v3",
    scripts: [environment.recaptchaScriptUrl],
    title: "reCAPTCHA v3",
  });
}

export function renderHCaptchaPage(environment: LabPageEnvironment, mode: LabChallengeMode) {
  return shell({
    body: challengeBody(
      mode,
      `<div class="h-captcha" data-callback="overtureLabChallengePassed" data-sitekey="${escapeAttribute(environment.hcaptchaSiteKey)}"></div>`,
    ),
    attributes: `data-lab-challenge="${mode}"`,
    page: "hcaptcha",
    scripts: [environment.hcaptchaScriptUrl],
    title: "hCaptcha",
  });
}

export function renderTurnstilePage(environment: LabPageEnvironment, mode: LabChallengeMode) {
  return shell({
    body: challengeBody(
      mode,
      `<div class="cf-turnstile" data-callback="overtureLabChallengePassed" data-sitekey="${escapeAttribute(environment.turnstileSiteKey)}"></div>`,
    ),
    attributes: `data-lab-challenge="${mode}"`,
    page: "turnstile",
    scripts: [environment.turnstileScriptUrl],
    title: "Turnstile",
  });
}

const autocompleteFor = (field: LabFormField) => {
  if (field.type === "email") {
    return ' autocomplete="email"';
  }

  if (field.name === "first_name") {
    return ' autocomplete="given-name"';
  }

  if (field.name === "last_name") {
    return ' autocomplete="family-name"';
  }

  return field.type === "text" ? ' autocomplete="name"' : "";
};

const formFieldMarkup = (ats: LabFormAts) =>
  LAB_FORM_FIELDS[ats]
    .map(
      (field) =>
        `<label>${field.label} <input name="${field.name}" type="${field.type}"${autocompleteFor(field)}${field.type === "file" ? ' accept="application/pdf"' : ""} required></label>`,
    )
    .join("\n");

const formOpenTag = (ats: LabFormAts) => {
  if (ats === "workable") {
    return `<form id="application-form" data-ui="application-form" action="/lab/forms/${ats}/submit" method="post">`;
  }

  if (ats === "personio") {
    return `<form action="/lab/forms/${ats}/submit" method="post">`;
  }

  return `<form id="application-form" action="/lab/forms/${ats}/submit" method="post">`;
};

export function renderFormPage(ats: LabFormAts) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overture lab — recorded ${ats} form</title>
<link rel="stylesheet" href="/lab/lab.css">
<script src="/lab/lab.js" defer></script>
</head>
<body data-lab-page="form" data-lab-ats="${ats}">
<main>
<h1>Recorded ${ats} form</h1>
${formOpenTag(ats)}
${formFieldMarkup(ats)}
<button type="submit">Submit application</button>
</form>
<p class="lab-note">This is an Overture lab page. No employer is involved.</p>
<p><a href="/lab">Back to the lab</a></p>
</main>
</body>
</html>
`;
}

export function renderConfirmationPage(ats: LabFormAts) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overture lab — ${ats} confirmation</title>
<link rel="stylesheet" href="/lab/lab.css">
</head>
<body data-lab-page="confirmation">
<main>
<h1 data-lab-confirmation="true">Your application was received</h1>
<p>The recorded ${ats} form accepted a submission with no employer involved.</p>
<p><a href="/lab">Back to the lab</a></p>
</main>
</body>
</html>
`;
}

export function renderLabIndex() {
  const items = LAB_PAGES.map(
    (definition) =>
      `<li><a href="${definition.path}">${definition.title}</a> <span class="lab-key">${definition.key}</span></li>`,
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overture lab</title>
<link rel="stylesheet" href="/lab/lab.css">
</head>
<body data-lab-page="index">
<main>
<h1>The synthetic lab</h1>
<p>Challenge pages and recorded forms that never involve an employer.</p>
<ul>
${items}
</ul>
</main>
</body>
</html>
`;
}
