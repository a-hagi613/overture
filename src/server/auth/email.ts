const gmailDomains = new Set(["gmail.com", "googlemail.com"]);

export function normaliseEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");

  if (at <= 0) {
    return trimmed;
  }

  const domain = trimmed.slice(at + 1);

  if (!gmailDomains.has(domain)) {
    return trimmed;
  }

  const local = trimmed.slice(0, at).split("+")[0]?.replaceAll(".", "") ?? "";

  if (local === "") {
    return trimmed;
  }

  return `${local}@gmail.com`;
}

export function isSameMailbox(a: string, b: string) {
  return normaliseEmail(a) === normaliseEmail(b);
}
