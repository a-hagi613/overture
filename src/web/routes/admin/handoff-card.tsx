import { ArrowUpRight } from "lucide-react";
import { useLocation } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { BrandMark } from "../../components/brand-mark.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card } from "../../components/ui/card.tsx";
import { dsBody } from "../../components/ui/ds.ts";
import { adminHostOf, handoffHref } from "../../lib/me-api.ts";

export function AdminHandoffCard({ adminOrigin }: { adminOrigin: string }) {
  const { hash, pathname, search } = useLocation();
  const href = handoffHref(adminOrigin, pathname, search, hash);

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <main
        className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10 outline-none md:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <Card className="p-6 md:p-8" variant="elevated">
          <div className="flex items-center gap-2.5">
            <BrandMark size={30} />
            <span className="font-serif text-card-title leading-none tracking-tight">
              {copy.app.name}
            </span>
          </div>
          <span className="mt-4 inline-flex items-center self-start rounded-full bg-signal-soft px-2.5 py-1 text-eyebrow font-semibold uppercase text-need">
            {copy.admin.adminPill}
          </span>
          <h1 className="mt-5 font-serif text-card-title leading-tight text-foreground">
            {copy.admin.handoffTitle}
          </h1>
          <p className={`${dsBody} mt-3`}>{copy.admin.handoffBody}</p>
          <Button asChild className="mt-6" variant="primary">
            <a href={href} rel="noopener noreferrer">
              {copy.admin.portalOpen}
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </Button>
          <p className="mt-4 break-words text-xs leading-relaxed text-muted-foreground">
            {copy.admin.handoffNote(adminHostOf(adminOrigin))}
          </p>
        </Card>
      </main>
    </div>
  );
}
