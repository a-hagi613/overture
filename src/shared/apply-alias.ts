import { z } from "zod";

/**
 * System addresses that exist on every Overture domain. A person's apply handle never uses one of
 * these as its whole local part or as its first dot-label, so a user handle can never shadow
 * `support@`, `notify@`, `mailer-daemon@` or the rest of the operator's own mailboxes (issue #566).
 */
export const RESERVED_ALIAS_LOCAL_PARTS = [
  "support",
  "hello",
  "security",
  "privacy",
  "admin",
  "no-reply",
  "noreply",
  "postmaster",
  "abuse",
  "billing",
  "help",
  "info",
  "legal",
  "notify",
  "alerts",
  "jobs",
  "careers",
  "apply",
  "webmaster",
  "hostmaster",
  "root",
  "mailer-daemon",
] as const;

const RESERVED = new Set<string>(RESERVED_ALIAS_LOCAL_PARTS);

const MAX_HANDLE_LENGTH = 32;

const FALLBACK_HANDLE = "person";

export const applyEmailInputSchema = z.object({
  usePersonalEmail: z.boolean(),
});

/**
 * Fold a person's name or email into lowercase ASCII words safe for a mail local part.
 * @param text The raw name or email fragment.
 * @returns Dot-separated words, possibly empty when nothing usable remains.
 */
export function normalizeAliasWords(text: string) {
  return text
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ".")
    .replaceAll(/^\.+|\.+$/gu, "")
    .replaceAll(/\.{2,}/gu, ".");
}

function firstAndLastName(name: string) {
  const [first, ...rest] = normalizeAliasWords(name).split(".");
  const last = rest.at(-1);

  if (first === undefined || first === "") {
    return "";
  }

  return last === undefined || last === "" ? first : `${first}.${last}`;
}

function clampHandle(handle: string) {
  if (handle.length <= MAX_HANDLE_LENGTH) {
    return handle;
  }

  const cut = handle.slice(0, MAX_HANDLE_LENGTH);

  return cut.includes(".") && !cut.endsWith(".") ? cut : cut.replace(/\.+$/u, "");
}

/**
 * A readable base handle: the person's first and last name when it has one, otherwise their email
 * local part. A base whose first dot-label is a reserved system prefix is refused like an exact
 * reserved word, so `support.smith` never becomes an alias (issue #566).
 * @param name The display name on the account, which may be blank.
 * @param email The sign-in email, whose local part is the fallback.
 * @returns A lowercase dot-separated handle that can never shadow a system address.
 */
export function aliasHandleBase(name: string, email: string) {
  const fromName = clampHandle(firstAndLastName(name));

  const fromEmail = clampHandle(
    normalizeAliasWords((email.split("@")[0] ?? "").split("+")[0] ?? ""),
  );

  for (const candidate of [fromName, fromEmail]) {
    if (candidate !== "" && !isReservedAliasHandle(candidate)) {
      return candidate;
    }
  }

  return FALLBACK_HANDLE;
}

/**
 * Whether a handle would collide with an Overture system address.
 * @param handle The candidate local part.
 * @returns True for an exact reserved local part or a reserved first label.
 */
export function isReservedAliasHandle(handle: string) {
  const [first] = handle.split(".");

  return RESERVED.has(handle) || (first !== undefined && RESERVED.has(first));
}

/**
 * Build one candidate local part: the base first, then `<base>.<suffix>` for later attempts.
 * @param base The readable base handle.
 * @param attempt The zero-based attempt; 0 is the bare base unless it is reserved.
 * @param suffix A short random suffix, already lowercase letters and digits.
 * @returns A candidate local part.
 */
export function aliasHandleCandidate(base: string, attempt: number, suffix: string) {
  const reserved = isReservedAliasHandle(base);
  const step = reserved ? attempt + 1 : attempt;

  return step === 0 ? base : `${base}.${suffix}`;
}

/**
 * A complete apply address for a handle on the configured domain.
 * @param handle The local part.
 * @param domain The alias domain from `ALIAS_EMAIL_DOMAIN`.
 * @returns `handle@domain`, lowercase.
 */
export function applyAliasAddress(handle: string, domain: string) {
  return `${handle.toLowerCase()}@${domain.trim().toLowerCase()}`;
}

/**
 * The address a new application puts on its email questions (issue #566): the alias while the
 * account keeps it, otherwise the sign-in email — never whatever the editable `email` fact holds.
 * @param usePersonalEmail The saved Profile → Account preference.
 * @param applyAddress The assigned alias, when the account has one.
 * @param personalEmail The sign-in email.
 * @returns The address to substitute into the plan.
 */
export function planEmailAddress(
  usePersonalEmail: boolean,
  applyAddress: string | null,
  personalEmail: string,
) {
  return usePersonalEmail || applyAddress === null ? personalEmail : applyAddress;
}
