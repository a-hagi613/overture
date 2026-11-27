/** The rendered parts of one outbound mail, built by `emails.ts`. */
export interface OutboundMailContent {
  /** The plain-text part, always sent alongside the HTML. */
  body: string;
  html: string;
  subject: string;
}

export interface OutboundMagicLinkMail extends OutboundMailContent {
  to: string;
}

/** The onboarding link an approved waitlist entry receives (WS-22). */
export interface OutboundWaitlistInviteMail extends OutboundMailContent {
  to: string;
}

export interface SentMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  html: string;
  replyTo: string | null;
  sentAt: number;
  headers?: Record<string, string>;
  attachments?: { bytes: number; filename: string; type: string }[];
}

export interface OutboundCheckMail extends OutboundMailContent {
  to: string;
}

/** The fallback alert for a verification code when no push endpoint is left (#565). */
export interface OutboundCodeWaitMail extends OutboundMailContent {
  to: string;
}

export interface OutboundAccountDeletedMail extends OutboundMailContent {
  to: string;
}

export interface OutboundExportReadyMail extends OutboundMailContent {
  to: string;
}

export interface OutboundBillingNoticeMail extends OutboundMailContent {
  to: string;
}

export interface OutboundSupportMail extends OutboundMailContent {
  to: string;
  /** The signed-in person's address, so the support desk can reply to them directly. */
  replyTo: string;
}

export interface OutboundSupportReplyMail extends OutboundMailContent {
  to: string;
}

export interface OutboundCopyAttachment {
  content: Uint8Array;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
}

/**
 * A copy of an inbound Message, sent to the account's current verified login email (issue #693).
 * The copy is always addressed from the Overture sending domain; `replyTo` is the original sender so
 * answering it goes back to the employer or recruiter.
 */
export interface OutboundInboundCopyMail extends OutboundMailContent {
  to: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: OutboundCopyAttachment[];
}

export interface InboundCopyDelivery {
  /** The sending provider's id for the copy, when it gave one. */
  messageId: string;
  /** True when the provider reported the recipient as a permanent bounce. */
  bounced: boolean;
}

export interface MailSender {
  sendMagicLink: (mail: OutboundMagicLinkMail) => Promise<void>;
  sendWaitlistInvite: (mail: OutboundWaitlistInviteMail) => Promise<void>;
  sendCheck: (mail: OutboundCheckMail) => Promise<void>;
  sendCodeWait: (mail: OutboundCodeWaitMail) => Promise<void>;
  sendAccountDeleted: (mail: OutboundAccountDeletedMail) => Promise<void>;
  sendExportReady: (mail: OutboundExportReadyMail) => Promise<void>;
  sendBillingNotice: (mail: OutboundBillingNoticeMail) => Promise<void>;
  sendSupport: (mail: OutboundSupportMail) => Promise<void>;
  sendSupportReply: (mail: OutboundSupportReplyMail) => Promise<void>;
  sendInboundCopy: (mail: OutboundInboundCopyMail) => Promise<InboundCopyDelivery>;
}
