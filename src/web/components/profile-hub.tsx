import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  LogOut,
  MessageCircle,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { ACCOUNT_SUBMENU, JOB_PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { PageHeader } from "./page-header.tsx";
import { SidebarThemeToggle } from "./sidebar-theme-toggle.tsx";
import { Card } from "./ui/card.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";
import { UsageCard } from "./usage.tsx";

const ROW_CLASS =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

const SUBMENU_ICONS = {
  account: Settings,
  billing: CreditCard,
  details: ClipboardList,
  preferences: SlidersHorizontal,
  resume: FileText,
} as const;

export function ProfileHub() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error === null) {
        queryClient.clear();
        await navigate("/signin");

        return;
      }

      toast.error(copy.settings.signOutThisError);
    } catch {
      toast.error(copy.settings.signOutThisError);
    }

    setSigningOut(false);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        lead={copy.nav.profileHub.lead}
        titleNode={
          <>
            {copy.nav.profileHub.titlePlain}
            <em className="italic text-signal">{copy.nav.profileHub.titleItalic}</em>
          </>
        }
      />
      <nav aria-label={copy.nav.profileMenu.label} className="mt-6 flex flex-col gap-5">
        <Card className="flex flex-col p-1.5">
          <p className={`${dsEyebrow} px-3 pb-1 pt-2`}>{copy.nav.jobProfile}</p>
          {JOB_PROFILE_SUBMENU.map((item) => {
            const Icon = SUBMENU_ICONS[item.key];

            return (
              <Link className={ROW_CLASS} key={item.key} to={item.to}>
                <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={20} />
                <span className="min-w-0 flex-1">{item.label}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                  size={18}
                />
              </Link>
            );
          })}
        </Card>
        <Card className="flex flex-col p-1.5">
          <p className={`${dsEyebrow} px-3 pb-1 pt-2`}>{copy.nav.accountSectionLabel}</p>
          {ACCOUNT_SUBMENU.map((item) => {
            const Icon = SUBMENU_ICONS[item.key];

            return (
              <Link className={ROW_CLASS} key={item.key} to={item.to}>
                <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={20} />
                <span className="min-w-0 flex-1">{item.label}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                  size={18}
                />
              </Link>
            );
          })}
          <Link className={ROW_CLASS} to="/support">
            <MessageCircle
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
              size={20}
            />
            <span className="min-w-0 flex-1">{copy.nav.support}</span>
            <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" size={18} />
          </Link>
          <SidebarThemeToggle />
          <Separator className="my-1.5" />
          <button
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-need transition hover:bg-need-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            disabled={signingOut}
            onClick={() => {
              void handleSignOut();
            }}
            type="button"
          >
            <LogOut aria-hidden="true" className="shrink-0" size={20} />
            <span>{signingOut ? copy.nav.signingOut : copy.nav.signOut}</span>
          </button>
        </Card>
      </nav>
      <div className="mt-5">
        <UsageCard />
      </div>
    </div>
  );
}
