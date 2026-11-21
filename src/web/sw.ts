import { z } from "zod";

const payloadSchema = z.object({
  body: z.string().optional(),
  tag: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

interface ExtendableEventLike {
  waitUntil: (promise: Promise<void>) => void;
}

interface PushEventLike extends ExtendableEventLike {
  data: { json: () => object } | null;
}

interface NotificationEventLike extends ExtendableEventLike {
  notification: { close: () => void; data: object };
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
declare function addEventListener(type: "fetch", listener: (event: Event) => void): void;
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

addEventListener("install", (event) => {
  event.waitUntil(skipWaiting());
});

addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

addEventListener("fetch", (event) => {
  void event;
});

addEventListener("push", (event) => {
  const parsed = payloadSchema.safeParse(event.data?.json() ?? {});
  const payload = parsed.success ? parsed.data : {};

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

  const data = payloadSchema.safeParse(event.notification.data);

  const target = new URL(data.success ? (data.data.url ?? "/") : "/", location.origin).href;

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
