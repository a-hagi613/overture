import {
  ChevronRight,
  CreditCard,
  FileText,
  MessageCircle,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { AdminPortalMenuItem } from "./admin-portal-menu-item.tsx";
import { PageHeader } from "./page-header.tsx";
import { SidebarThemeToggle } from "./sidebar-theme-toggle.tsx";
import { Card } from "./ui/card.tsx";
import { Separator } from "./ui/separator.tsx";

const ROW_CLASS =
  "flex min-h-14 items-center gap-3 rounded-md px-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

const PROFILE_ICONS = {
  account: ShieldCheck,
  billing: CreditCard,
  details: User,
  preferences: SlidersHorizontal,
  resume: FileText,
} as const;

export function ProfileHub() {
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
      <nav aria-label={copy.nav.profileMenu.label} className="mt-6">
        <Card className="p-1.5">
          <ul className="flex flex-col">
            {PROFILE_SUBMENU.map((item) => {
              const Icon = PROFILE_ICONS[item.key];

              return (
                <li key={item.key}>
                  <Link className={ROW_CLASS} to={item.to}>
                    <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" size={20} />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                      size={18}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Separator className="my-1.5" />
          <div className="flex flex-col">
            <Link className={ROW_CLASS} to="/support">
              <MessageCircle
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
                size={20}
              />
              <span className="min-w-0 flex-1">{copy.nav.support}</span>
              <ChevronRight
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
                size={18}
              />
            </Link>
            <AdminPortalMenuItem className={ROW_CLASS} />
            <SidebarThemeToggle />
          </div>
        </Card>
      </nav>
    </div>
  );
}
