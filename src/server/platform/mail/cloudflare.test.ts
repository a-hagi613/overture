import { afterAll, expect, test } from "bun:test";

import { z } from "zod";

import { createCloudflareMailSender } from "./cloudflare.ts";

const sentBodySchema = z.object({
  from: z.string(),
  reply_to: z.string().optional(),
  subject: z.string(),
  text: z.string(),
  to: z.array(z.string()),
});

const sent: unknown[] = [];

const mail = Bun.serve({
  port: 0,
  fetch: async (request) => {
    sent.push(JSON.parse(await request.text()));

    return Response.json({ result: { message_id: "message-1" }, success: true });
  },
});

afterAll(() => {
  void mail.stop(true);
});

const sender = createCloudflareMailSender({
  accountId: "account-1",
  apiToken: "token-1",
  baseUrl: `http://127.0.0.1:${String(mail.port)}`,
  from: "Overture <no-reply@tryoverture.com>",
});

test("a support mail keeps its one-line subject and reply-to address", async () => {
  await sender.sendSupport({
    body: "Hello",
    replyTo: "person@example.test",
    subject: "Ready card",
    to: "support@tryoverture.com",
  });

  expect(sentBodySchema.parse(sent.at(-1))).toEqual({
    from: "Overture <no-reply@tryoverture.com>",
    reply_to: "person@example.test",
    subject: "Ready card",
    text: "Hello",
    to: ["support@tryoverture.com"],
  });
});

test("a subject carrying a line break is flattened to one line before it is sent", async () => {
  await sender.sendSupportReply({
    body: "Hello",
    subject: "  Re: Ready card\r\nBcc: evil@example.test\n\n",
    to: "person@example.test",
  });

  const payload = sentBodySchema.parse(sent.at(-1));

  expect(payload.subject).toBe("Re: Ready card Bcc: evil@example.test");
  expect(payload.reply_to).toBeUndefined();
});
