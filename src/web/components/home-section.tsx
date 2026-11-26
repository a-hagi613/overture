import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { PanelEmpty } from "./ui/panel-empty.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

/**
 * One Home section in the strict attention order: a counted header that opens the matching page
 * and a list of rows that open the exact item.
 *
 * @param props Section identity, count, destination and body.
 * @param props.children The section rows, or nothing when the section is empty.
 * @param props.count The honest total the count badge shows.
 * @param props.countLabel The badge wording, such as `4 open`.
 * @param props.dataTestId Optional test id for the section card.
 * @param props.emptyAction Optional one action that fills the empty state.
 * @param props.emptyBody Optional second line in the empty state.
 * @param props.emptyTitle Optional empty-state title; without it an empty section renders nothing.
 * @param props.error True when the data behind the section failed to load.
 * @param props.href The page or filtered view the count opens.
 * @param props.onRetry Re-runs the failed section load.
 * @param props.subtitle One line under the heading.
 * @param props.title The section heading; also the accessible name.
 * @param props.titleId The heading id the card is labelled by.
 * @param props.variant Tints the count badge with the section's meaning.
 * @param props.viewAll The count link's visible label.
 * @returns The section card, its error state, its empty state, or nothing.
 */
export function HomeSection({
  children,
  count,
  countLabel,
  dataTestId,
  emptyAction,
  emptyBody,
  emptyTitle,
  error = false,
  href,
  onRetry,
  subtitle,
  title,
  titleId,
  variant = "secondary",
  viewAll,
}: {
  children?: ReactNode;
  count: number;
  countLabel: string;
  dataTestId?: string | undefined;
  emptyAction?: ReactNode;
  emptyBody?: string | undefined;
  emptyTitle?: string | undefined;
  error?: boolean | undefined;
  href: string;
  onRetry?: (() => void) | undefined;
  subtitle?: string | undefined;
  title: string;
  titleId: string;
  variant?: "secondary" | "need" | "ok" | "signal" | undefined;
  viewAll: string;
}) {
  if (!error && count === 0 && emptyTitle === undefined) {
    return null;
  }

  let body: ReactNode;

  if (error) {
    body = (
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5"
        role="alert"
      >
        <p className="text-sm text-foreground">{copy.home.sections.loadFailed}</p>
        {onRetry === undefined ? null : (
          <Button onClick={onRetry} size="sm" variant="outline">
            {copy.home.sections.retry}
          </Button>
        )}
      </div>
    );
  } else if (count === 0) {
    body = <PanelEmpty action={emptyAction} description={emptyBody} title={emptyTitle} />;
  } else {
    body = <PanelList>{children}</PanelList>;
  }

  return (
    <Card ariaLabelledBy={titleId} className="overflow-hidden" dataTestId={dataTestId}>
      <PanelHeader
        action={
          <Button asChild size="sm" variant="secondary">
            <Link aria-label={copy.home.sections.openLabel(viewAll, title, countLabel)} to={href}>
              {viewAll}
              <ChevronRight aria-hidden="true" size={14} />
            </Link>
          </Button>
        }
        badge={
          error ? undefined : (
            <Badge className="tabular-nums" variant={variant}>
              {countLabel}
            </Badge>
          )
        }
        subtitle={subtitle}
        title={title}
        titleId={titleId}
      />
      {body}
    </Card>
  );
}
