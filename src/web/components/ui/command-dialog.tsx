import { Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

export function CommandDialog({
  children,
  description,
  onOpenChange,
  onValueChange,
  open,
  placeholder,
  title,
  value,
}: {
  children: ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  open: boolean;
  placeholder: string;
  title: string;
  value: string;
}) {
  return (
    <Root onOpenChange={onOpenChange} open={open}>
      <Portal>
        <Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-xs" />
        <Content className="fixed left-1/2 top-20 z-50 w-full max-w-xl -translate-x-1/2 px-4 outline-none">
          <Title className="sr-only">{title}</Title>
          <Description className="sr-only">{description}</Description>
          <Command
            className="overflow-hidden rounded-xl border border-input bg-card text-foreground shadow-lifth"
            shouldFilter={false}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="h-12 w-full bg-transparent text-sm font-medium text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground"
                onValueChange={onValueChange}
                placeholder={placeholder}
                value={value}
              />
            </div>
            <Command.List className="max-h-96 overflow-y-auto p-2">{children}</Command.List>
          </Command>
        </Content>
      </Portal>
    </Root>
  );
}
