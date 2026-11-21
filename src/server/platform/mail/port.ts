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

export interface MailSender {
  sendMagicLink: (mail: OutboundMagicLinkMail) => Promise<void>;
  sendCheck: (mail: OutboundCheckMail) => Promise<void>;
  sendReadyRecap: (mail: OutboundReadyRecapMail) => Promise<void>;
}
