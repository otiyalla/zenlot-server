export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
  disposition?: 'attachment' | 'inline' | 'string';
  contentId?: string;
  encoding?: 'base64';
};

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
