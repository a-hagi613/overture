import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { registerTopLayerHost } from "./top-layer-host.ts";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openSheetCount = 0;
let savedOverflow: string | null = null;

function lockBodyScroll() {
  if (openSheetCount === 0) {
    savedOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
  }

  openSheetCount += 1;

  return () => {
    openSheetCount -= 1;

    if (openSheetCount === 0 && savedOverflow !== null) {
      globalThis.document.body.style.overflow = savedOverflow;
      savedOverflow = null;
    }
  };
}

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
    const unlockScroll = scrollLock ? lockBodyScroll() : null;

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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null && !element.matches(":disabled"),
      );

      const first = focusable.at(0);
      const last = focusable.at(-1);

      if (first === undefined || last === undefined) {
        return;
      }

      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
    node.addEventListener("keydown", onKeyDown);

    return () => {
      node.removeEventListener("cancel", onCancel);
      node.removeEventListener("click", onClick);
      node.removeEventListener("keydown", onKeyDown);

      unregisterHost();

      if (node.open) {
        node.close();
      }

      unlockScroll?.();

      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [focusSelector, ref, scrollLock]);
}
