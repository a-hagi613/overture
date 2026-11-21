import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";

type TabKey = keyof typeof copy.settingsAccount.tabs;

const tabs: { key: TabKey; to: string | null }[] = [
  { key: "notifications", to: null },
  { key: "export", to: "/settings/export" },
  { key: "delete", to: "/settings/delete" },
  { key: "supportAccess", to: null },
  { key: "legal", to: null },
];

const baseClass =
  "flex h-11 items-center justify-center rounded-full border px-3.5 text-[13px] font-semibold leading-[normal] min-[768px]:h-9";

export function SettingsAccountTabs({ active }: { active: TabKey }) {
  return (
    <nav aria-label={copy.settingsAccount.tabsLabel} className="mt-[22px] flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const current = tab.key === active;

        if (current) {
          return (
            <span
              aria-current="page"
              className={`${baseClass} border-foreground bg-foreground text-background`}
              key={tab.key}
            >
              {copy.settingsAccount.tabs[tab.key]}
            </span>
          );
        }

        if (tab.to === null) {
          return (
            <span
              aria-disabled="true"
              className={`${baseClass} border-input bg-card text-foreground`}
              key={tab.key}
              title={copy.settingsAccount.unavailable}
            >
              {copy.settingsAccount.tabs[tab.key]}
            </span>
          );
        }

        return (
          <Link
            className={`${baseClass} border-input bg-card text-foreground hover:bg-muted`}
            key={tab.key}
            to={tab.to}
          >
            {copy.settingsAccount.tabs[tab.key]}
          </Link>
        );
      })}
    </nav>
  );
}
