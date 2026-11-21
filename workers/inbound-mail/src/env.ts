import type { InboundQueueMessage } from "../../../src/shared/inbound-queue.ts";

export interface ForwardableEmailMessage {
  from: string;
  to: string;
  rawSize: number;
  raw: ReadableStream<Uint8Array>;
  forward: (to: string) => Promise<void>;
  setReject: (reason: string) => void;
}

export interface InboundQueueProducer {
  send: (message: InboundQueueMessage) => Promise<void>;
}

export interface InboundSpillObject {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface InboundSpillBucket {
  put: (key: string, value: Uint8Array<ArrayBuffer>) => Promise<void>;
  get: (key: string) => Promise<InboundSpillObject | null>;
  delete: (key: string) => Promise<void>;
}

export interface InboundQueueMessageHandle {
  id: string;
  timestamp: Date;
  attempts: number;
  body: InboundQueueMessage | string;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

export interface InboundQueueBatch {
  queue: string;
  messages: InboundQueueMessageHandle[];
}

export interface InboundMailEnv {
  INBOUND_HMAC_SECRET: string;
  OVERTURE_ORIGIN: string;
  OWNER_FORWARD_TO: string;
  INBOUND_QUEUE: InboundQueueProducer;
  INBOUND_SPILL: InboundSpillBucket;
}
