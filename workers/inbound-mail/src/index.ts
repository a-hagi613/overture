import { INBOUND_DEAD_LETTER_QUEUE_NAME } from "../../../src/shared/inbound-queue.ts";

import type { InboundMailEnv, InboundQueueBatch, InboundQueueMessageHandle } from "./env.ts";

import { deadLetter } from "./dead-letter-consumer.ts";
import { deliver } from "./deliver.ts";
import { email } from "./handler.ts";

type InboundQueueHandler = (
  message: InboundQueueMessageHandle,
  env: InboundMailEnv,
) => Promise<void>;

async function consume(
  handler: InboundQueueHandler,
  message: InboundQueueMessageHandle,
  env: InboundMailEnv,
) {
  try {
    await handler(message, env);
  } catch {
    message.retry();
  }
}

async function queue(batch: InboundQueueBatch, env: InboundMailEnv) {
  const handler = batch.queue === INBOUND_DEAD_LETTER_QUEUE_NAME ? deadLetter : deliver;

  await Promise.all(
    batch.messages.map(async (message) => {
      await consume(handler, message, env);
    }),
  );
}

const worker = { email, queue };

export default worker;
