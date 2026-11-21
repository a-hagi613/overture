import { z } from "zod";

const publicKeySchema = z.object({ publicKey: z.string().nullable() });

export function pushSupported() {
  return (
    "serviceWorker" in navigator && "PushManager" in globalThis && "Notification" in globalThis
  );
}

export function notificationPermission() {
  return "Notification" in globalThis ? globalThis.Notification.permission : "denied";
}

function applicationServerKey(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));

  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}

export async function currentPushSubscription() {
  if (!pushSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function enablePush() {
  const response = await fetch("/api/push");

  if (!response.ok) {
    throw new Error(`The request failed with ${String(response.status)}.`);
  }

  const { publicKey } = publicKeySchema.parse(await response.json());

  if (publicKey === null) {
    throw new Error("Push is not configured.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Notifications were not allowed.");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      applicationServerKey: applicationServerKey(publicKey),
      userVisibleOnly: true,
    }));

  const json = subscription.toJSON();

  if (json.endpoint === undefined || json.keys === undefined) {
    throw new Error("The browser returned an incomplete subscription.");
  }

  const saved = await fetch("/api/push/subscribe", {
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { auth: json.keys.auth, p256dh: json.keys.p256dh },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!saved.ok) {
    throw new Error(`The request failed with ${String(saved.status)}.`);
  }

  return subscription;
}

export async function disablePush() {
  const subscription = await currentPushSubscription();

  if (subscription === null) {
    return;
  }

  await fetch("/api/push/unsubscribe", {
    body: JSON.stringify({ endpoint: subscription.endpoint }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  await subscription.unsubscribe();
}
