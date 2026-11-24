import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { SidebarContent } from "./sidebar-content.tsx";

export function SidebarDrawer({
  counts,
  onOpenChange,
  onOpenSearch,
  open,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onOpenChange: (open: boolean) => void;
  onOpenSearch: () => void;
  open: boolean;
  unreadNotifications?: number;
}) {
  const closeDrawer = () => {
    onOpenChange(false);
  };

  return (
    <Root onOpenChange={onOpenChange} open={open}>
      <Portal>
        <Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-xs" />
        <Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-sidebar shadow-lift outline-none">
          <Title className="sr-only">{copy.nav.sidebarDrawerTitle}</Title>
          <Description className="sr-only">{copy.nav.sidebarDrawerDescription}</Description>
          <SidebarContent
            counts={counts}
            onCollapse={closeDrawer}
            onNavigate={closeDrawer}
            onOpenSearch={() => {
              closeDrawer();
              onOpenSearch();
            }}
            unreadNotifications={unreadNotifications}
          />
        </Content>
      </Portal>
    </Root>
  );
}
