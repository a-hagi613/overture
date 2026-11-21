import { z } from "zod";

export const INBOUND_QUEUE_NAME = "overture-inbound-mail";
export const INBOUND_DEAD_LETTER_QUEUE_NAME = "overture-inbound-mail-dlq";
export const INBOUND_DEAD_LETTER_PATH = "/internal/mail/dead-letter";
export const INBOUND_SPILL_PREFIX = "spill/";

export const INBOUND_QUEUE_MAX_BYTES = 128 * 1024;
export const INBOUND_QUEUE_MAX_RETRIES = 100;
export const INBOUND_QUEUE_RETRY_DELAY_SECONDS = 300;
export const INBOUND_QUEUE_RETENTION_SECONDS = 14 * 24 * 60 * 60;
export const INBOUND_SPILL_LIFECYCLE_DAYS = 30;

const envelope = {
  rcptTo: z.string().min(1),
  mailFrom: z.string(),
  receivedAt: z.number().int().nonnegative(),
  reference: z.uuid(),
};

const inlineMessageSchema = z.object({
  kind: z.literal("inline"),
  ...envelope,
  bodyBase64: z.string().min(1),
});

const spilledMessageSchema = z.object({
  kind: z.literal("spill"),
  ...envelope,
  spillKey: z.string().min(1),
});

export const inboundQueueMessageSchema = z.discriminatedUnion("kind", [
  inlineMessageSchema,
  spilledMessageSchema,
]);

export type InboundQueueMessage = z.infer<typeof inboundQueueMessageSchema>;

export const INBOUND_DEAD_LETTER_REASONS = [
  "refused",
  "spill_missing",
  "spill_unavailable",
  "malformed",
  "retries_exhausted",
] as const;

export const inboundDeadLetterSchema = z.object({
  reason: z.enum(INBOUND_DEAD_LETTER_REASONS),
  attempts: z.number().int().nonnegative(),
  status: z.number().int().min(100).max(599).nullable(),
  reference: z.uuid(),
  rcptTo: z.string().min(1).nullable(),
  mailFrom: z.string(),
  spillKey: z.string().min(1).nullable(),
});

export type InboundDeadLetter = z.infer<typeof inboundDeadLetterSchema>;

export function inboundQueueMessageBytes(message: InboundQueueMessage) {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
}

export function base64ToBytes(text: string) {
  return Uint8Array.from(atob(text), (character) => character.codePointAt(0) ?? 0);
}

export function parseInboundDeadLetter(body: Uint8Array<ArrayBuffer>) {
  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return inboundDeadLetterSchema.safeParse(null);
  }

  return inboundDeadLetterSchema.safeParse(value);
}

export function parseInboundQueueBody(body: InboundQueueMessage | string) {
  const direct = inboundQueueMessageSchema.safeParse(body);

  if (direct.success) {
    return direct;
  }

  const text = z.string().min(1).safeParse(body);

  if (!text.success) {
    return direct;
  }

  try {
    return inboundQueueMessageSchema.safeParse(JSON.parse(text.data));
  } catch {
    return direct;
  }
}
