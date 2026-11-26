import { useCallback, useEffect, useRef } from "react";

import { copy } from "../../shared/copy.ts";
import { turnstileScriptUrl as defaultScriptUrl } from "../../shared/turnstile.ts";
import type { TurnstileAction } from "../../shared/turnstile.ts";

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: TurnstileAction;
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  callback?: (token: string) => void;
  "error-callback"?: (error: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  execute: (widgetId?: string) => void;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }

  var turnstile: TurnstileApi | undefined;
}

export type TurnstileFailure = "error" | "expired" | "missing" | "timeout" | "unavailable";

export interface TurnstileTokenResult {
  token: string | null;
  failure: TurnstileFailure | null;
}

function succeeded(token: string) {
  return { failure: null, token } satisfies TurnstileTokenResult;
}

function failed(failure: TurnstileFailure) {
  return { failure, token: null } satisfies TurnstileTokenResult;
}

export function turnstileFailureMessage(failure: TurnstileFailure | null) {
  if (failure === "timeout") {
    return copy.signIn.captchaTimedOut;
  }

  if (failure === "expired") {
    return copy.signIn.captchaExpired;
  }

  if (failure === "error") {
    return copy.signIn.captchaFailed;
  }

  if (failure === "unavailable") {
    return copy.signIn.captchaUnavailable;
  }

  return copy.signIn.captchaMissing;
}

interface RenderedWidget {
  action: TurnstileAction;
  element: HTMLDivElement;
  id: string;
  serial: number;
  siteKey: string;
}

interface CachedToken {
  action: TurnstileAction;
  token: string;
}

interface InflightChallenge {
  consumed: boolean;
  promise: Promise<TurnstileTokenResult>;
}

const scriptLoadTimeoutMs = 10_000;
const configWaitTimeoutMs = 10_000;
const challengeTimeoutMs = 30_000;

const scriptLoads = new Map<string, Promise<boolean>>();

function currentTurnstile() {
  return globalThis.turnstile;
}

async function after(ms: number) {
  return new Promise<false>((resolve) => {
    globalThis.setTimeout(() => {
      resolve(false);
    }, ms);
  });
}

async function loadTurnstileScript(url: string) {
  const existing = scriptLoads.get(url);

  if (existing !== undefined) {
    return existing;
  }

  const loading = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");

    script.async = true;
    script.dataset["turnstile"] = "";
    script.src = url;
    script.addEventListener(
      "load",
      () => {
        if (globalThis.turnstile === undefined) {
          script.remove();
          scriptLoads.delete(url);
        }

        resolve(globalThis.turnstile !== undefined);
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        scriptLoads.delete(url);
        resolve(false);
      },
      { once: true },
    );
    document.head.append(script);
  });

  scriptLoads.set(url, loading);

  return loading;
}

async function readyTurnstile(url: string) {
  const existing = currentTurnstile();

  if (existing !== undefined) {
    return existing;
  }

  await Promise.race([loadTurnstileScript(url), after(scriptLoadTimeoutMs)]);

  return currentTurnstile() ?? null;
}

export function useTurnstile(
  siteKey: string | null | undefined,
  action: TurnstileAction,
  scriptUrl: string = defaultScriptUrl,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<RenderedWidget | null>(null);
  const tokenRef = useRef<CachedToken | null>(null);
  const serialRef = useRef(0);
  const waiterRef = useRef<((result: TurnstileTokenResult) => void) | null>(null);
  const inflightRef = useRef<InflightChallenge | null>(null);
  const needsResetRef = useRef(false);
  const autoRefreshRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const siteKeyRef = useRef<string | null | undefined>(siteKey);
  const actionRef = useRef<TurnstileAction>(action);
  const scriptUrlRef = useRef(scriptUrl);
  const configWaiterRef = useRef<(() => void) | null>(null);
  const configReadyRef = useRef<Promise<void> | null>(null);

  const settle = useCallback((result: TurnstileTokenResult) => {
    const waiter = waiterRef.current;

    waiterRef.current = null;

    if (result.token !== null) {
      autoRefreshRef.current = false;
    }

    if (waiter === null) {
      if (result.token !== null) {
        tokenRef.current = { action: actionRef.current, token: result.token };
      }

      return;
    }

    waiter(result);
  }, []);

  const fail = useCallback((failure: TurnstileFailure) => {
    const waiter = waiterRef.current;

    waiterRef.current = null;
    waiter?.({ failure, token: null });
  }, []);

  const removeWidget = useCallback(() => {
    const widget = widgetRef.current;

    widgetRef.current = null;
    tokenRef.current = null;
    needsResetRef.current = false;
    autoRefreshRef.current = false;

    if (widget !== null && widget.element.isConnected && globalThis.turnstile !== undefined) {
      globalThis.turnstile.remove(widget.id);
    }
  }, []);

  useEffect(() => {
    siteKeyRef.current = siteKey;
    scriptUrlRef.current = scriptUrl;
    removeWidget();

    if (siteKey === undefined) {
      return;
    }

    const waiter = configWaiterRef.current;

    configWaiterRef.current = null;
    waiter?.();
  }, [removeWidget, scriptUrl, siteKey]);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(
    () => () => {
      removeWidget();
      fail("error");
    },
    [fail, removeWidget],
  );

  useEffect(() => {
    if (siteKey === null || siteKey === undefined) {
      return;
    }

    void loadTurnstileScript(scriptUrl);
  }, [scriptUrl, siteKey]);

  const widgetFor = useCallback(async () => {
    const key = siteKeyRef.current;

    if (key === null || key === undefined) {
      return null;
    }

    const widgetAction = actionRef.current;
    const container = containerRef.current;
    const { current } = widgetRef;

    if (
      current !== null &&
      container !== null &&
      current.element === container &&
      current.siteKey === key &&
      current.action === widgetAction
    ) {
      return current;
    }

    removeWidget();

    const turnstile = await readyTurnstile(scriptUrlRef.current);

    if (
      turnstile === null ||
      containerRef.current === null ||
      siteKeyRef.current !== key ||
      actionRef.current !== widgetAction
    ) {
      return null;
    }

    const element = containerRef.current;

    serialRef.current += 1;

    const serial = serialRef.current;
    const active = () => widgetRef.current?.serial === serial;

    const id = turnstile.render(element, {
      sitekey: key,
      action: widgetAction,
      appearance: "interaction-only",
      execution: "execute",
      callback: (token) => {
        if (active()) {
          settle(succeeded(token));
        }
      },
      "error-callback": () => {
        if (active()) {
          fail("error");
        }
      },
      "expired-callback": () => {
        if (!active()) {
          return;
        }

        tokenRef.current = null;
        needsResetRef.current = true;

        if (waiterRef.current !== null) {
          fail("expired");
        }

        // A token that expires while the form is still being filled should not make the user wait on
        // the next click: fetch a fresh one in the background. Guarded so a repeated expiry cannot
        // loop, and reset on the next successful token.
        if (!autoRefreshRef.current) {
          autoRefreshRef.current = true;
          globalThis.setTimeout(() => {
            refreshRef.current();
          }, 0);
        }
      },
      "timeout-callback": () => {
        if (active()) {
          tokenRef.current = null;
          needsResetRef.current = true;
          fail("timeout");
        }
      },
    });

    widgetRef.current = { action: widgetAction, element, id, serial, siteKey: key };

    return widgetRef.current;
  }, [fail, removeWidget, settle]);

  const challenge = useCallback(async (): Promise<TurnstileTokenResult> => {
    if (siteKeyRef.current === undefined) {
      configReadyRef.current ??= new Promise<void>((resolve) => {
        configWaiterRef.current = resolve;
      });

      await Promise.race([configReadyRef.current, after(configWaitTimeoutMs)]);
    }

    if (siteKeyRef.current === undefined) {
      return failed("unavailable");
    }

    if (siteKeyRef.current === null) {
      return failed("missing");
    }

    let widget: RenderedWidget | null;

    try {
      widget = await widgetFor();
    } catch {
      return failed("error");
    }

    if (widget === null || globalThis.turnstile === undefined) {
      return failed("unavailable");
    }

    const { turnstile } = globalThis;

    if (needsResetRef.current) {
      needsResetRef.current = false;

      try {
        turnstile.reset(widget.id);
      } catch {
        return failed("error");
      }
    }

    const result = await new Promise<TurnstileTokenResult>((resolve) => {
      let finished = false;

      const finish = (value: TurnstileTokenResult) => {
        if (finished) {
          return;
        }

        finished = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      };

      const timer = globalThis.setTimeout(() => {
        needsResetRef.current = true;
        turnstile.reset(widget.id);
        finish(failed("timeout"));
      }, challengeTimeoutMs);

      waiterRef.current = finish;

      try {
        turnstile.execute(widget.id);
      } catch {
        finish(failed("error"));
      }
    });

    needsResetRef.current = true;

    return result;
  }, [widgetFor]);

  const prewarm = useCallback(async () => {
    if (tokenRef.current !== null || inflightRef.current !== null) {
      return;
    }

    const key = siteKeyRef.current;

    if (key === null || key === undefined) {
      return;
    }

    const widgetAction = actionRef.current;
    const entry: InflightChallenge = { consumed: false, promise: challenge() };

    inflightRef.current = entry;

    try {
      const result = await entry.promise;

      if (
        !entry.consumed &&
        result.token !== null &&
        siteKeyRef.current === key &&
        actionRef.current === widgetAction
      ) {
        tokenRef.current = { action: widgetAction, token: result.token };
      }
    } catch {
      // A failed warm leaves the cache empty; the next click runs the challenge and reports it.
    } finally {
      if (inflightRef.current === entry) {
        inflightRef.current = null;
      }
    }
  }, [challenge]);

  useEffect(() => {
    refreshRef.current = () => {
      void prewarm();
    };
  }, [prewarm]);

  const hasToken = useCallback(
    () => tokenRef.current !== null && tokenRef.current.action === actionRef.current,
    [],
  );

  const obtainToken = useCallback(async () => {
    autoRefreshRef.current = false;

    const cached = tokenRef.current;

    if (cached !== null && cached.action === actionRef.current) {
      tokenRef.current = null;
      needsResetRef.current = true;

      return succeeded(cached.token);
    }

    tokenRef.current = null;

    const running = inflightRef.current;

    if (running !== null) {
      running.consumed = true;

      try {
        return await running.promise;
      } catch {
        return failed("error");
      }
    }

    const entry: InflightChallenge = { consumed: true, promise: challenge() };

    inflightRef.current = entry;

    try {
      return await entry.promise;
    } catch {
      return failed("error");
    } finally {
      if (inflightRef.current === entry) {
        inflightRef.current = null;
      }
    }
  }, [challenge]);

  return { containerRef, hasToken, obtainToken, prewarm };
}
