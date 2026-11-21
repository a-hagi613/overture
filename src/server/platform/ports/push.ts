export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSender {
  send: (subscription: PushSubscription, payload: PushPayload) => Promise<"ok" | "gone">;
}
