import { Link, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";

const tabs = [
  { key: "notifications", path: "/settings/notifications" },
  { key: "export", path: "/settings/export" },
  { key: "delete", path: "/settings/delete" },
  { key: "support", path: "/settings/support-access" },
  { key: "legal", path: "/settings/legal" },
] as const;

const built = new Set<string>(["/settings/export"]);

export function SettingsTabs() {
  const { pathname } = useLocation();

  return (
    <nav aria-label={copy.settings.accountTabs.label} className="mt-[13px] flex flex-wrap gap-2.5">
      {tabs.map((tab) => {
        const active = pathname === tab.path;

        const classes = `inline-flex h-11 min-[768px]:h-9 items-center rounded-full px-[18px] text-[13.5px] font-semibold leading-none ${
          active
            ? "border border-foreground bg-foreground text-primary-ink"
            : "border border-border bg-card text-foreground"
        }`;

        if (!built.has(tab.path)) {
          return (
            <span aria-disabled="true" className={classes} key={tab.key}>
              {copy.settings.accountTabs[tab.key]}
            </span>
          );
        }

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`${classes} cursor-pointer ${active ? "" : "hover:bg-muted"}`}
            key={tab.key}
            to={tab.path}
          >
            {copy.settings.accountTabs[tab.key]}
          </Link>
        );
      })}
    </nav>
  );
}
