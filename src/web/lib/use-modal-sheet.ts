import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { registerTopLayerHost } from "./top-layer-host.ts";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalSheetOptions {
  focusSelector?: string;
  scrollLock?: boolean;
}

export function useModalSheet(
  ref: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
  options: ModalSheetOptions = {},
) {
  const onCloseRef = useRef(onClose);
  const scrollLock = options.scrollLock ?? true;
  const focusSelector = options.focusSelector ?? FOCUSABLE;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = ref.current;

    if (node === null) {
      return () => undefined;
    }

    const opener = globalThis.document.activeElement;
    const previousOverflow = globalThis.document.body.style.overflow;

    if (scrollLock) {
      globalThis.document.body.style.overflow = "hidden";
    }

    if (!node.open) {
      node.showModal();
    }

    const unregisterHost = registerTopLayerHost(node, () => {
      onCloseRef.current();
    });

    const firstVisible = (selector: string) =>
      [...node.querySelectorAll<HTMLElement>(selector)].find(
        (element) => element.offsetParent !== null,
      );

    const target = firstVisible(focusSelector) ?? firstVisible(FOCUSABLE) ?? node;

    target.focus();

    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };

    const onClick = (event: MouseEvent) => {
      if (event.target !== node) {
        return;
      }

      const box = node.getBoundingClientRect();

      const outside =
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom;

      if (outside) {
        onCloseRef.current();
      }
    };

    node.addEventListener("cancel", onCancel);
    node.addEventListener("click", onClick);

    return () => {
      node.removeEventListener("cancel", onCancel);
      node.removeEventListener("click", onClick);

      unregisterHost();

      if (node.open) {
        node.close();
      }

      if (scrollLock) {
        globalThis.document.body.style.overflow = previousOverflow;
      }

      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [focusSelector, ref, scrollLock]);
}
