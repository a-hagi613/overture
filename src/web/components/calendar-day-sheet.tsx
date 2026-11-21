import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function CalendarDaySheet({
  children,
  headingId,
  onClose,
}: {
  children: ReactNode;
  headingId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;

    if (node !== null && !node.open) {
      node.showModal();
      node.querySelector<HTMLElement>("button:not([tabindex='-1'])")?.focus();
    }
  }, []);

  return (
    <dialog
      aria-labelledby={headingId}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 text-foreground md:hidden"
      onClose={onClose}
      ref={dialog}
    >
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-input bg-card px-4 pb-[18px] pt-2.5 shadow-lift">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-sm bg-input" />
        {children}
      </div>
    </dialog>
  );
}
