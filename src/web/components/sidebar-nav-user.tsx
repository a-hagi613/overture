import {
  Content,
  Item,
  Label,
  Portal,
  Root,
  Separator,
  Trigger,
} from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, CreditCard, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { useTheme } from "../lib/theme-context.ts";
import { TooltipHint } from "./ui/tooltip-hint.tsx";
import { UserAvatar } from "./user-avatar.tsx";

const ITEM_CLASS =
  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-foreground outline-none transition focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function resolveDisplayName(name: string | undefined, email: string) {
  const trimmed = (name ?? "").trim();

  if (trimmed.length > 0) {
    return trimmed;
  }

  const localPart = email.split("@")[0]?.trim() ?? "";

  return localPart.length > 0 ? localPart : copy.nav.userFallback;
}

export function SidebarNavUser({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { theme, toggleTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const email = session?.user.email ?? "";
  const displayName = resolveDisplayName(session?.user.name, email);
  const isDark = theme === "dark";

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error === null) {
        queryClient.clear();
        onNavigate?.();
        await navigate("/signin");

        return;
      }

      toast.error(copy.settings.signOutThisError);
    } catch {
      toast.error(copy.settings.signOutThisError);
    }

    setSigningOut(false);
  };

  const trigger = compact ? (
    <TooltipHint label={displayName}>
      <Trigger asChild>
        <button
          aria-label={copy.nav.accountMenuLabel}
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-transparent transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground data-[state=open]:border-border data-[state=open]:bg-card"
          type="button"
        >
          <UserAvatar email={email} name={displayName} size="md" />
        </button>
      </Trigger>
    </TooltipHint>
  ) : (
    <Trigger asChild>
      <button
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground data-[state=open]:border-border data-[state=open]:bg-card"
        type="button"
      >
        <UserAvatar email={email} name={displayName} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
          {email === "" ? null : (
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          )}
        </span>
        <span className="sr-only">{copy.nav.accountMenuLabel}</span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </Trigger>
  );

  return (
    <Root>
      {trigger}
      <Portal>
        <Content
          align="end"
          className="z-50 w-60 rounded-xl border border-input bg-card p-1.5 text-foreground shadow-lift outline-none"
          side={compact ? "right" : "top"}
          sideOffset={8}
        >
          <Label className="flex items-center gap-2.5 px-2.5 py-2 font-normal">
            <UserAvatar email={email} name={displayName} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
              {email === "" ? null : (
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              )}
            </span>
          </Label>
          <Separator className="my-1 h-px bg-border" />
          <Item asChild className={ITEM_CLASS}>
            <Link onClick={onNavigate} to="/profile/billing">
              <CreditCard aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{copy.nav.profileMenu.billing}</span>
            </Link>
          </Item>
          <Item asChild className={ITEM_CLASS}>
            <Link onClick={onNavigate} to="/profile/account">
              <Settings aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{copy.nav.accountSettings}</span>
            </Link>
          </Item>
          <Separator className="my-1 h-px bg-border" />
          <Item
            className={ITEM_CLASS}
            onSelect={(event) => {
              event.preventDefault();
              toggleTheme();
            }}
          >
            {isDark ? (
              <Sun aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-text" />
            ) : (
              <Moon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1">{isDark ? copy.shell.lightMode : copy.shell.darkMode}</span>
            <span
              aria-hidden="true"
              className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                isDark ? "border-foreground bg-foreground" : "border-input bg-muted"
              }`}
            >
              <span
                className={`block h-3.5 w-3.5 rounded-full bg-card transition-transform ${
                  isDark ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </Item>
          <Separator className="my-1 h-px bg-border" />
          <Item
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-need outline-none transition focus:bg-need-soft focus:text-need data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            disabled={signingOut}
            onSelect={() => {
              void handleSignOut();
            }}
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{signingOut ? copy.nav.signingOut : copy.nav.signOut}</span>
          </Item>
        </Content>
      </Portal>
    </Root>
  );
}
