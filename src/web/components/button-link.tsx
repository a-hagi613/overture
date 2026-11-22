import type { ReactNode } from "react";

export function ButtonLink({
  children,
  href,
  variant,
}: {
  children: ReactNode;
  href: string;
  variant: "primary" | "secondary";
}) {
  const base =
    "inline-flex min-h-[50px] items-center justify-center rounded-lg px-[22px] text-[15px] font-semibold md:px-6";

  return (
    <a
      className={
        variant === "primary"
          ? `${base} bg-foreground text-background hover:bg-btn-hover`
          : `${base} border border-input bg-transparent text-foreground hover:bg-muted`
      }
      href={href}
    >
      {children}
    </a>
  );
}
