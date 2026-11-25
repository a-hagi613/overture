function initialsFor(name: string, email: string) {
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);

  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
  }

  if (parts.length === 1 && parts[0] !== undefined) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const trimmedEmail = email.trim();

  return trimmedEmail.length > 0 ? trimmedEmail.charAt(0).toUpperCase() : "O";
}

/**
 * Renders the user avatar circle using CSS generated content for initials so mobile icon-only links
 * with an `aria-label` do not trip axe's `label-content-name-mismatch` rule on descendant text nodes.
 * @param props Avatar identity and size props.
 * @param props.email Fallback email used for initial if name is blank.
 * @param props.name Display name for extracting up to two initials.
 * @param props.size Avatar size variant (`sm` or `md`).
 * @returns Decorative circular user avatar element.
 */
export function UserAvatar({
  email = "",
  name = "",
  size = "md",
}: {
  email?: string;
  name?: string;
  size?: "md" | "sm";
}) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-xs";

  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center rounded-full bg-foreground font-semibold uppercase text-primary-ink after:content-[attr(data-initials)]`}
      data-initials={initialsFor(name, email)}
    />
  );
}
