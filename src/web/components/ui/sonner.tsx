import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          actionButton:
            "!rounded-md !border !border-input !bg-card !px-2.5 !py-1 !text-xs !font-semibold !text-foreground hover:!bg-muted",
          cancelButton:
            "!rounded-md !bg-muted !px-2.5 !py-1 !text-xs !font-medium !text-muted-foreground",
          closeButton: "!border-border !bg-card !text-muted-foreground hover:!text-foreground",
          description: "!text-xs !text-muted-foreground",
          title: "!text-sm !font-semibold !text-foreground",
          toast:
            "!rounded-xl !border !border-border !bg-card !text-foreground !shadow-lift !font-sans",
        },
      }}
    />
  );
}
