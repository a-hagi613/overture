import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const CLASSIFICATIONS = [
  "ack",
  "code",
  "rejection",
  "screening",
  "interview",
  "offer",
  "other",
] as const;

const attachmentSchema = z.object({
  bytes: z.number(),
  filename: z.string(),
  id: z.string(),
  mime: z.string(),
});

export const threadRowSchema = z.object({
  applicationId: z.string().nullable(),
  classification: z.enum(CLASSIFICATIONS).nullable(),
  company: z.string(),
  id: z.string(),
  lastMessageAt: z.number(),
  needsChecking: z.boolean(),
  snippet: z.string(),
  subject: z.string(),
  title: z.string().nullable(),
  unread: z.boolean(),
});

export type InboxThreadRow = z.infer<typeof threadRowSchema>;

const threadsResponseSchema = z.object({
  counts: z.object({ all: z.number(), needsChecking: z.number(), unread: z.number() }),
  threads: z.array(threadRowSchema),
});

export type InboxThreadsResponse = z.infer<typeof threadsResponseSchema>;

const messageSchema = z.object({
  attachments: z.array(attachmentSchema),
  auth: z.enum(["pass", "fail", "none"]),
  classification: z.enum(CLASSIFICATIONS).nullable(),
  createdAt: z.number(),
  direction: z.enum(["in", "out"]),
  from: z.string(),
  id: z.string(),
  readAt: z.number().nullable(),
  subject: z.string(),
  text: z.string(),
});

export type InboxMessage = z.infer<typeof messageSchema>;

const threadResponseSchema = z.object({
  messages: z.array(messageSchema),
  thread: threadRowSchema,
});

export type InboxThreadResponse = z.infer<typeof threadResponseSchema>;

const mailboxSchema = z.object({
  address: z.string(),
  firstForwardedAt: z.number().nullable(),
  forwardingWorks: z.boolean(),
});

export type Mailbox = z.infer<typeof mailboxSchema>;

async function loadThreads() {
  const response = await fetch("/api/threads");

  if (!response.ok) {
    throw new Error(`The Inbox request did not go through (${String(response.status)}).`);
  }

  return threadsResponseSchema.parse(await response.json());
}

export function useThreads() {
  return useQuery({ queryKey: ["threads"], queryFn: loadThreads });
}

async function loadThread(id: string) {
  const response = await fetch(`/api/threads/${encodeURIComponent(id)}`);

  if (!response.ok) {
    throw new Error(`The thread request did not go through (${String(response.status)}).`);
  }

  return threadResponseSchema.parse(await response.json());
}

export function useThread(id: string | null) {
  return useQuery({
    enabled: id !== null,
    queryFn: async () => loadThread(id ?? ""),
    queryKey: ["thread", id],
  });
}

const readResponseSchema = z.object({ id: z.string(), readAt: z.number() });

async function markRead(id: string) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`The read request did not go through (${String(response.status)}).`);
  }

  return readResponseSchema.parse(await response.json());
}

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

async function loadMailbox() {
  const response = await fetch("/api/profile/mailbox");

  if (!response.ok) {
    throw new Error(`The forwarding address request did not go through.`);
  }

  return mailboxSchema.parse(await response.json());
}

export function useMailbox() {
  return useQuery({ queryKey: ["mailbox"], queryFn: loadMailbox });
}

export function attachmentHref(id: string) {
  return `/api/attachments/${encodeURIComponent(id)}`;
}
