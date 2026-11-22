import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer.tsx";
import { MarketingHeader } from "./marketing-header.tsx";

/**
 * The shared marketing shell: the same header and footer on the landing and pricing pages.
 * `scope` names the page's board (`landing`), so the board-specific header and footer apply.
 * `footerAfterContent` keeps the footer directly under the last section instead of pinning it to
 * the bottom of a tall viewport, which is how the pricing board is drawn.
 * @param props The page content, its board scope, and whether the footer follows it.
 * @returns The marketing page element.
 */
export function MarketingPage(props: {
  children: ReactNode;
  footerAfterContent?: boolean;
  scope?: string;
}) {
  const { children, footerAfterContent = false, scope } = props;
  const landing = scope === "landing";

  return (
    <div
      className={`flex min-h-dvh flex-col bg-background text-foreground ${landing ? "" : "leading-[1.55]"} ${scope ?? ""}`.trim()}
    >
      <MarketingHeader landing={landing} />
      <main
        className={landing || !footerAfterContent ? "flex-1 outline-none" : "outline-none"}
        id="main-content"
        tabIndex={-1}
      >
        {children}
      </main>
      <MarketingFooter landing={landing} />
    </div>
  );
}
