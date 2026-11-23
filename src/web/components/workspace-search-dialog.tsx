import { Command } from "cmdk";
import {
  Bell,
  Briefcase,
  Calendar,
  CircleHelp,
  CreditCard,
  FileText,
  Home,
  Inbox,
  Mail,
  MessageCircle,
  Send,
  Settings,
  SlidersHorizontal,
  SquareKanban,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useWorkspaceSearch } from "../lib/workspace-search-api.ts";
import { Badge } from "./ui/badge.tsx";
import { CommandDialog } from "./ui/command-dialog.tsx";

const QUICK_LINKS = [
  { icon: Home, label: copy.nav.home, to: "/home" },
  { icon: SquareKanban, label: copy.nav.board, to: "/board" },
  { icon: Send, label: copy.nav.ready, to: "/ready" },
  { icon: CircleHelp, label: copy.nav.review, to: "/review" },
  { icon: Inbox, label: copy.nav.inbox, to: "/inbox" },
  { icon: Calendar, label: copy.nav.calendar, to: "/calendar" },
  { icon: FileText, label: copy.nav.profileMenu.resume, to: "/profile/resume" },
  { icon: User, label: copy.nav.profileMenu.details, to: "/profile/details" },
  { icon: SlidersHorizontal, label: copy.nav.profileMenu.preferences, to: "/profile/preferences" },
  { icon: CreditCard, label: copy.nav.profileMenu.billing, to: "/profile/billing" },
  { icon: Settings, label: copy.nav.profileMenu.account, to: "/profile/account" },
  { icon: MessageCircle, label: copy.nav.support, to: "/support" },
  { icon: Bell, label: copy.shell.notificationsEmpty, to: "/notifications" },
] as const;

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground outline-none aria-selected:bg-muted data-[selected=true]:bg-muted";

const GROUP_HEADING_CLASS =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground";

const SEARCH_DEBOUNCE_MS = 250;

export function WorkspaceSearchDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (open && query.trim() !== "") {
      timer = globalThis.setTimeout(() => {
        setDebouncedQuery(query);
      }, SEARCH_DEBOUNCE_MS);
    }

    return () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [open, query]);

  const activeQuery = !open || query.trim() === "" ? "" : debouncedQuery;
  const { data, isError, isFetching } = useWorkspaceSearch(activeQuery, open);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };

    const onOpenEvent = () => {
      onOpenChange(true);
    };

    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("overture:open-search", onOpenEvent);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("overture:open-search", onOpenEvent);
    };
  }, [onOpenChange, open]);

  const go = (to: string) => {
    onOpenChange(false);
    setQuery("");
    setDebouncedQuery("");
    void navigate(to);
  };

  const trimmed = query.trim();
  const searchPending = isFetching || (trimmed !== "" && activeQuery.trim() !== trimmed);
  const apps = data?.applications ?? [];
  const reviews = data?.reviews ?? [];
  const emails = data?.emails ?? [];
  const interviews = data?.interviews ?? [];
  const totalResults = apps.length + reviews.length + emails.length + interviews.length;

  return (
    <CommandDialog
      description={copy.shell.searchPlaceholder}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setQuery("");
          setDebouncedQuery("");
        }
      }}
      onValueChange={setQuery}
      open={open}
      placeholder={copy.shell.searchPlaceholder}
      title={copy.shell.searchLabel}
      value={query}
    >
      {trimmed === "" ? (
        <Command.Group className={GROUP_HEADING_CLASS} heading={copy.shell.searchQuickJump}>
          {QUICK_LINKS.map((item) => {
            const Icon = item.icon;

            return (
              <Command.Item
                className={ITEM_CLASS}
                key={item.to}
                onSelect={() => {
                  go(item.to);
                }}
                value={item.label}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{item.label}</span>
              </Command.Item>
            );
          })}
        </Command.Group>
      ) : null}

      {trimmed !== "" && searchPending && totalResults === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {copy.shell.searchLoading}
        </p>
      ) : null}

      {trimmed !== "" && !searchPending && isError ? (
        <p className="px-3 py-6 text-center text-sm font-medium text-need" role="alert">
          {copy.shell.searchError}
        </p>
      ) : null}

      {trimmed !== "" && !searchPending && !isError && totalResults === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {copy.shell.searchEmpty}
        </p>
      ) : null}

      {apps.length > 0 ? (
        <Command.Group className={GROUP_HEADING_CLASS} heading={copy.shell.searchGroups.apps}>
          {apps.map((app) => (
            <Command.Item
              className={ITEM_CLASS}
              key={app.id}
              onSelect={() => {
                go(`/board?card=${encodeURIComponent(app.id)}`);
              }}
              value={`app-${app.id}`}
            >
              <Briefcase aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{app.company}</p>
                <p className="truncate text-xs text-muted-foreground">{app.title}</p>
              </div>
              {app.stage === null ? null : (
                <Badge variant="secondary">{copy.stages[app.stage]}</Badge>
              )}
            </Command.Item>
          ))}
        </Command.Group>
      ) : null}

      {reviews.length > 0 ? (
        <Command.Group className={GROUP_HEADING_CLASS} heading={copy.shell.searchGroups.reviews}>
          {reviews.map((review) => (
            <Command.Item
              className={ITEM_CLASS}
              key={review.id}
              onSelect={() => {
                go("/review");
              }}
              value={`review-${review.id}`}
            >
              <CircleHelp aria-hidden="true" className="h-4 w-4 shrink-0 text-need" />
              <span className="min-w-0 flex-1 truncate font-medium">{review.prompt}</span>
              <Badge variant="need">{copy.home.needsYou.jobsUnlocked(review.unlockedCount)}</Badge>
            </Command.Item>
          ))}
        </Command.Group>
      ) : null}

      {emails.length > 0 ? (
        <Command.Group className={GROUP_HEADING_CLASS} heading={copy.shell.searchGroups.emails}>
          {emails.map((email) => (
            <Command.Item
              className={ITEM_CLASS}
              key={email.id}
              onSelect={() => {
                go(`/inbox/${encodeURIComponent(email.threadId)}`);
              }}
              value={`email-${email.id}`}
            >
              <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-ok" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{email.company ?? email.subject}</p>
                <p className="truncate text-xs text-muted-foreground">{email.subject}</p>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      ) : null}

      {interviews.length > 0 ? (
        <Command.Group className={GROUP_HEADING_CLASS} heading={copy.shell.searchGroups.interviews}>
          {interviews.map((interview) => (
            <Command.Item
              className={ITEM_CLASS}
              key={interview.id}
              onSelect={() => {
                go("/calendar");
              }}
              value={`interview-${interview.id}`}
            >
              <Calendar aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-text" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{interview.company}</p>
                <p className="truncate text-xs text-muted-foreground">{interview.summary}</p>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      ) : null}
    </CommandDialog>
  );
}
