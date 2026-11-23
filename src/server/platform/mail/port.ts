export interface OutboundMagicLinkMail {
  to: string;
  url: string;
}

export interface SentMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  replyTo: string | null;
  sentAt: number;
}

export interface OutboundCheckMail {
  to: string;
  subject: string;
  body: string;
}

export interface OutboundReadyRecapMail {
  to: string;
  subject: string;
  body: string;
}

export interface OutboundAccountDeletedMail {
  to: string;
  name: string;
}

export interface OutboundExportReadyMail {
  to: string;
  subject: string;
  body: string;
}

export interface OutboundBillingNoticeMail {
  to: string;
  subject: string;
  body: string;
}

export interface OutboundSupportMail {
  to: string;
  subject: string;
  body: string;
  /** The signed-in person's address, so the support desk can reply to them directly. */
  replyTo: string;
}

export interface OutboundSupportReplyMail {
  to: string;
  subject: string;
  body: string;
}

export interface MailSender {
  sendMagicLink: (mail: OutboundMagicLinkMail) => Promise<void>;
  sendCheck: (mail: OutboundCheckMail) => Promise<void>;
  sendReadyRecap: (mail: OutboundReadyRecapMail) => Promise<void>;
  sendAccountDeleted: (mail: OutboundAccountDeletedMail) => Promise<void>;
  sendExportReady: (mail: OutboundExportReadyMail) => Promise<void>;
  sendBillingNotice: (mail: OutboundBillingNoticeMail) => Promise<void>;
  sendSupport: (mail: OutboundSupportMail) => Promise<void>;
  sendSupportReply: (mail: OutboundSupportReplyMail) => Promise<void>;
}
