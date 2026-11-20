import { useCallback, useEffect, useRef } from "react";

export interface TurnstileRenderOptions {
  sitekey: string;
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

interface TokenWaiter {
  resolve: (token: string | null) => void;
}

export function useTurnstile(siteKey: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waitersRef = useRef<TokenWaiter[]>([]);

  const settle = useCallback((token: string | null) => {
    const waiters = waitersRef.current;

    waitersRef.current = [];

    if (waiters.length === 0) {
      tokenRef.current = token;

      return;
    }

    if (globalThis.turnstile !== undefined) {
      globalThis.turnstile.reset();
    }

    for (const waiter of waiters) {
      waiter.resolve(token);
    }
  }, []);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    const clear = () => {
      cancelled = true;

      if (widgetId !== null && globalThis.turnstile !== undefined) {
        globalThis.turnstile.remove(widgetId);
      }
    };

    if (siteKey === null || containerRef.current === null) {
      settle(null);

      return clear;
    }

    const setup = (turnstile: TurnstileApi) => {
      if (cancelled || containerRef.current === null) {
        return;
      }

      widgetId = turnstile.render(containerRef.current, {
        sitekey: siteKey,
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
  }, [settle, siteKey]);

  const obtainToken = async () => {
    const token = tokenRef.current;

    if (token !== null) {
      tokenRef.current = null;

      if (globalThis.turnstile !== undefined) {
        globalThis.turnstile.reset();
      }

      return token;
    }

    if (siteKey === null) {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      waitersRef.current.push({ resolve });
    });
  };

  return { containerRef, obtainToken };
}
