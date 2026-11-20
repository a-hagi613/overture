import { useCallback, useEffect, useRef } from "react";

import type { TurnstileAction } from "../../shared/turnstile.ts";

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: TurnstileAction;
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "error-callback"?: (error: string) => void;
}

interface TurnstileApi {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }

  var turnstile: TurnstileApi | undefined;
}

const readyEvent = "overture:turnstile-ready";

export function useTurnstile(siteKey: string | null, action: TurnstileAction) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waiterRef = useRef<((token: string | null) => void) | null>(null);

  const settle = useCallback((token: string | null) => {
    const waiter = waiterRef.current;

    waiterRef.current = null;

    if (waiter === null) {
      tokenRef.current = token;

      return;
    }

    waiter(token);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clear = () => {
      cancelled = true;

      if (widgetIdRef.current !== null && globalThis.turnstile !== undefined) {
        globalThis.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = null;
      tokenRef.current = null;
    };

    if (siteKey === null || containerRef.current === null) {
      settle(null);

      return clear;
    }

    const setup = (turnstile: TurnstileApi) => {
      if (cancelled || containerRef.current === null) {
        return;
      }

      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        callback: (token) => {
          settle(token);
        },
        "error-callback": () => {
          settle(null);
        },
      });
    };

    if (globalThis.turnstile === undefined) {
      globalThis.addEventListener(
        readyEvent,
        () => {
          if (globalThis.turnstile !== undefined) {
            setup(globalThis.turnstile);
          }
        },
        { once: true },
      );
    } else {
      setup(globalThis.turnstile);
    }

    return clear;
  }, [action, settle, siteKey]);

  const obtainToken = useCallback(async () => {
    if (siteKey === null) {
      return null;
    }

    const token =
      tokenRef.current ??
      (await new Promise<string | null>((resolve) => {
        waiterRef.current = resolve;
      }));

    tokenRef.current = null;

    if (widgetIdRef.current !== null && globalThis.turnstile !== undefined) {
      globalThis.turnstile.reset(widgetIdRef.current);
    }

    return token;
  }, [siteKey]);

  return { containerRef, obtainToken };
}
