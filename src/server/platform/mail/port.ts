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

export interface MailSender {
  sendMagicLink: (mail: OutboundMagicLinkMail) => Promise<void>;
}
