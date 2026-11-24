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
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center rounded-full bg-foreground font-semibold uppercase text-primary-ink`}
    >
      {initialsFor(name, email)}
    </span>
  );
}
