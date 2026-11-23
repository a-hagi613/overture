export interface PushPayload {
  body?: string | undefined;
  tag?: string | undefined;
  title?: string | undefined;
  url?: string | undefined;
}

interface ExtendableEventLike {
  waitUntil: (promise: Promise<void>) => void;
}

interface PushEventLike extends ExtendableEventLike {
  data: { json: () => PushPayload | null | undefined } | null;
}

interface NotificationEventLike extends ExtendableEventLike {
  notification: { close: () => void; data: PushPayload | null | undefined };
}

interface ClientLike {
  focus: () => Promise<void>;
  navigate: (url: string) => Promise<void>;
  url: string;
}

declare function addEventListener(
  type: "install" | "activate",
  listener: (event: ExtendableEventLike) => void,
): void;
declare function addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
declare function addEventListener(
  type: "notificationclick",
  listener: (event: NotificationEventLike) => void,
): void;
declare function skipWaiting(): Promise<void>;

declare const clients: {
  claim: () => Promise<void>;
  matchAll: (options: { includeUncontrolled: boolean; type: "window" }) => Promise<ClientLike[]>;
  openWindow: (url: string) => Promise<void>;
};

declare const location: { origin: string };

declare const registration: {
  showNotification: (
    title: string,
    options: {
      badge: string;
      body: string;
      data: { url: string };
      icon: string;
      tag: string;
    },
  ) => Promise<void>;
};

function optionalString(value: string | undefined) {
  return Object.prototype.toString.call(value) === "[object String]" ? value : undefined;
}

function parsePayload(raw: PushPayload | null | undefined) {
  if (
    raw === null ||
    raw === undefined ||
    Object.prototype.toString.call(raw) !== "[object Object]"
  ) {
    return {} satisfies PushPayload;
  }

  return {
    body: optionalString(raw.body),
    tag: optionalString(raw.tag),
    title: optionalString(raw.title),
    url: optionalString(raw.url),
  } satisfies PushPayload;
}

function readPushPayload(event: PushEventLike) {
  if (event.data === null) {
    return {} satisfies PushPayload;
  }

  try {
    return parsePayload(event.data.json());
  } catch {
    return {} satisfies PushPayload;
  }
}

function resolveTargetUrl(rawUrl: string | undefined) {
  try {
    const parsed = new URL(rawUrl ?? "/", location.origin);

    return parsed.origin === location.origin ? parsed.href : new URL("/", location.origin).href;
  } catch {
    return new URL("/", location.origin).href;
  }
}

addEventListener("install", (event) => {
  event.waitUntil(skipWaiting());
});

addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

addEventListener("push", (event) => {
  const payload = readPushPayload(event);

  event.waitUntil(
    registration.showNotification(payload.title ?? "Overture", {
      badge: "/icons/icon-192.png",
      body: payload.body ?? "Open Overture for the latest.",
      data: { url: payload.url ?? "/" },
      icon: "/icons/icon-192.png",
      tag: payload.tag ?? "overture",
    }),
  );
});

addEventListener("notificationclick", (event) => {
  event.notification.close();

  const payload = parsePayload(event.notification.data);
  const target = resolveTargetUrl(payload.url);

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });

      const open = clientList.find((client) => client.url.startsWith(location.origin));

      if (open !== undefined) {
        await open.focus();
        await open.navigate(target);

        return;
      }

      await clients.openWindow(target);
    })(),
  );
});
