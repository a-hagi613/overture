import { useEffect, useRef, useState } from "react";

export interface TurnstileRenderOptions {
  sitekey: string;
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "error-callback"?: () => void;
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

export function useTurnstile(siteKey: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [hasToken, setHasToken] = useState(false);

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
          tokenRef.current = token;
          setHasToken(true);
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
  }, [siteKey]);

  return {
    containerRef,
    hasToken,
    consume: () => {
      const token = tokenRef.current;

      tokenRef.current = null;
      setHasToken(false);

      if (globalThis.turnstile !== undefined) {
        globalThis.turnstile.reset();
      }

      return token;
    },
  };
}
