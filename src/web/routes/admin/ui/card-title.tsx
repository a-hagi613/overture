import type { ReactNode } from "react";

export function CardTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="font-serif text-card-title leading-[1.1]" id={id}>
      {children}
    </h2>
  );
}
