import type { ReactNode } from "react";

export function ButtonLink({
  children,
  className,
  href,
  variant,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant: "primary" | "secondary";
}) {
  const base =
    "box-content inline-flex min-h-[48px] items-center justify-center rounded-lg px-5 text-[15px] font-semibold";

  return (
    <a
      className={[
        variant === "primary"
          ? `${base} border border-foreground bg-foreground text-background hover:bg-btn-hover`
          : `${base} border border-input bg-card text-foreground hover:bg-muted`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      href={href}
    >
      {children}
    </a>
  );
}
