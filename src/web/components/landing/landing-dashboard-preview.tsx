import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { useTheme } from "../../lib/theme-context.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { dsContainer, dsEyebrow, dsSectionHeading } from "../ui/ds.ts";
import { SegmentedControl } from "../ui/segmented-control.tsx";
import { SegmentedControlItem } from "../ui/segmented-control-item.tsx";
import { LANDING_COPY } from "./landing-copy.ts";

type ScreenId = "home" | "board" | "inbox" | "calendar" | "profile";

interface ScreenDef {
  id: ScreenId;
  label: string;
}

const screens: readonly ScreenDef[] = [
  { id: "home", label: "Home" },
  { id: "board", label: "Tracker" },
  { id: "inbox", label: "Inbox" },
  { id: "calendar", label: "Calendar" },
  { id: "profile", label: "Profile" },
];

function isScreenId(value: string): value is ScreenId {
  return screens.some((screen) => screen.id === value);
}

export function LandingDashboardPreview() {
  const { theme } = useTheme();
  const [activeScreen, setActiveScreen] = useState<ScreenId>("home");
  const [themeOverride, setThemeOverride] = useState<boolean | null>(null);

  const previewDark = themeOverride ?? theme === "dark";
  const activeDef = screens.find((item) => item.id === activeScreen) ?? screens[0];

  const togglePreviewTheme = () => {
    setThemeOverride(!previewDark);
  };

  const desktopSrc = `/previews/${activeScreen}-${previewDark ? "dark" : "light"}.png?v=5`;
  const mobileSrc = `/previews/${activeScreen}-mobile-${previewDark ? "dark" : "light"}.png?v=5`;
  const altText = `Overture ${activeDef?.label ?? "Home"} screen (${previewDark ? "dark" : "light"} mode)`;

  return (
    <section
      aria-labelledby="dashboard-preview-title"
      className={`${dsContainer} pb-16 pt-4 sm:pb-24 sm:pt-6`}
      id="dashboard-preview"
    >
      <div className="mx-auto max-w-2xl text-center">
        <Badge size="eyebrow" variant="signal">
          {LANDING_COPY.preview.badge}
        </Badge>
        <h2 className={`${dsSectionHeading} mt-4`} id="dashboard-preview-title">
          {LANDING_COPY.preview.headingPlain}
          <span className="italic">{LANDING_COPY.preview.headingItalic}</span>
        </h2>
      </div>

      <div className="mt-8 flex items-end justify-center lg:justify-start lg:pl-24">
        <div className="inline-flex items-end gap-2 text-muted-foreground">
          <svg
            aria-hidden="true"
            className="h-7 w-7 translate-y-1 text-signal-text"
            fill="none"
            viewBox="0 0 32 32"
          >
            <path
              d="M25 5C15 6 9 13 9 25"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.75"
            />
            <path
              d="M4.5 20.5L9 25.5L13.5 20.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
          <span className="pb-2 font-serif text-base italic text-foreground">
            {LANDING_COPY.preview.hint}
          </span>
        </div>
      </div>

      <Card className="mt-2 overflow-hidden" variant="elevated">
        <div className="flex flex-col gap-0">
          <div className="relative flex flex-col gap-3 border-b border-border bg-sidebar p-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-4 lg:py-2.5">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
              <span className={`${dsEyebrow} inline-flex min-h-11 items-center gap-2 lg:min-h-8`}>
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-signal animate-hint-pulse"
                />
                {LANDING_COPY.preview.viewLabel}
              </span>
              <SegmentedControl
                ariaLabel="Workspace preview screens"
                className="grid w-full grid-cols-5 border-0 bg-transparent p-0 lg:inline-flex lg:w-auto"
                onValueChange={(value) => {
                  if (isScreenId(value)) {
                    setActiveScreen(value);
                  }
                }}
                value={activeScreen}
              >
                {screens.map((screen) => (
                  <SegmentedControlItem
                    className="min-h-11 border border-transparent px-1.5 text-xs hover:border-border hover:bg-card data-[state=on]:border-signal data-[state=on]:text-signal-text md:min-h-9 lg:min-h-8 lg:px-3.5 lg:text-sm"
                    key={screen.id}
                    value={screen.id}
                  >
                    {screen.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>

            <Button
              ariaLabel={previewDark ? "Preview light mode" : "Preview dark mode"}
              className="absolute right-3 top-2.5 lg:static"
              onClick={togglePreviewTheme}
              size="sm"
              variant="secondary"
            >
              {previewDark ? (
                <Sun aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <Moon aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              <span>{previewDark ? "Light" : "Dark"}</span>
            </Button>
          </div>
        </div>

        <div className="bg-background">
          <div className="mx-auto w-full max-w-[390px] overflow-hidden bg-background sm:my-4 sm:rounded-xl sm:border sm:border-border sm:shadow-sh lg:hidden">
            <img alt={altText} className="block h-auto w-full" src={mobileSrc} />
          </div>
          <div className="hidden aspect-[1280/860] w-full overflow-hidden bg-background lg:block">
            <img
              alt={altText}
              className="block h-full w-full object-cover object-top"
              src={desktopSrc}
            />
          </div>
        </div>
      </Card>
    </section>
  );
}
