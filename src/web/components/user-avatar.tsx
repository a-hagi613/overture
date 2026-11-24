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
 * The initials are painted with `after:content-[attr(data-initials)]` instead of a text child.
 * The phone header's profile link is named "Profile" through `aria-label`, and axe's
 * `label-content-name-mismatch` reads every descendant text node (aria-hidden included), so an
 * initials text child there is treated as visible text missing from the link's accessible name.
 * CSS generated content keeps the same pixels without adding text to that link.
 * @param props The session identity and the avatar size.
 * @param props.email The session email, used for the first letter when there is no name.
 * @param props.name The display name the initials come from.
 * @param props.size `md` in the sidebar, `sm` in the phone header.
 * @returns The decorative avatar bubble.
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
