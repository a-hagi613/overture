import { useSyncExternalStore } from "react";

interface TopLayerHost {
  element: HTMLElement;
  requestClose: () => void;
}

const hosts: TopLayerHost[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function topHost() {
  return hosts.at(-1)?.element ?? null;
}

/**
 * Tracks the `<dialog>` of the modal sheet that is currently in the browser's top layer.
 *
 * Shared overlays rendered in `AppShell` (the toaster) portal into it, because a native modal
 * `<dialog>` makes everything outside it inert, and a z-index cannot cross the top layer.
 *
 * @returns The open sheet's `<dialog>`, or null when no sheet is open.
 */
export function useTopLayerHost() {
  return useSyncExternalStore(subscribe, topHost, topHost);
}

/**
 * Registers an open modal sheet as the host for shared overlays.
 *
 * @param element The sheet's `<dialog>`.
 * @param requestClose Closes the sheet through its own owner, as Escape and the backdrop do.
 * @returns A cleanup that unregisters the sheet.
 */
export function registerTopLayerHost(element: HTMLElement, requestClose: () => void) {
  hosts.push({ element, requestClose });
  notify();

  return () => {
    const index = hosts.findIndex((host) => host.element === element);

    if (index !== -1) {
      hosts.splice(index, 1);
    }

    notify();
  };
}

/**
 * Closes every sheet that owns the top layer, before an app-level overlay opens.
 *
 * A native modal `<dialog>` sits above the document and makes everything outside it inert, so a
 * command palette or another app overlay cannot open on top of one. Closing all of them also
 * handles a confirmation dialog stacked over a sheet.
 *
 * @returns The number of sheets that were asked to close.
 */
export function closeAllTopLayerHosts() {
  const open = [...hosts].reverse();

  for (const host of open) {
    host.requestClose();
  }

  return open.length;
}
