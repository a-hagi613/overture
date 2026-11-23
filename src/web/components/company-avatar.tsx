import { cn } from "./ui/cn.ts";

export function CompanyAvatar({
  className,
  company,
  logoUrl,
  size = "sm",
}: {
  className?: string;
  company: string;
  logoUrl?: string | null | undefined;
  size?: "sm" | "lg";
  tone?: "neutral" | "signal";
}) {
  const monogram = company.trim().slice(0, 1).toUpperCase();

  const dimensions =
    size === "lg" ? "h-12 w-12 rounded-xl text-card-title" : "h-9 w-9 rounded-lg text-base";

  if (logoUrl !== undefined && logoUrl !== null && logoUrl.length > 0) {
    return (
      <img
        alt={company}
        className={cn(
          "shrink-0 border border-border bg-card object-contain p-1",
          dimensions,
          className,
        )}
        src={logoUrl}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center border border-border bg-muted font-serif italic text-foreground",
        dimensions,
        className,
      )}
    >
      {monogram}
    </span>
  );
}
