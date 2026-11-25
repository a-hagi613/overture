import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsPageTitle } from "../components/ui/ds.ts";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex flex-1 max-w-xl items-center justify-center py-12">
      <Card className="w-full p-8 text-center" variant="default">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <Compass aria-hidden="true" size={24} />
        </div>
        <h1 className={`${dsPageTitle} mt-4`}>
          {`${copy.nav.profilePages.notFoundTitlePlain}${copy.nav.profilePages.notFoundTitleItalic}`}
        </h1>
        <p className={`${dsBody} mx-auto mt-2 max-w-sm`}>{copy.notFound.body}</p>
        <div className="mt-6">
          <Button asChild size="default" variant="primary">
            <Link to="/home">
              <ArrowLeft aria-hidden="true" size={15} />
              <span>{copy.nav.profilePages.notFoundHome}</span>
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
