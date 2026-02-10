import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailMessage,
  EmailTransport,
} from '../interfaces/email-transport.interface';

@Injectable()
export class SendGridEmailTransport implements EmailTransport {
  private readonly logger = new Logger(SendGridEmailTransport.name);
  private initialized = false;
  private client:
    | {
        setApiKey: (apiKey: string) => void;
        send: (msg: unknown) => Promise<unknown>;
      }
    | undefined;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    try {
      // Keep SendGrid as an optional dependency so nodemailer-only setups still boot.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.client = require('@sendgrid/mail');
    } catch {
      this.logger.warn(
        'SendGrid package not installed. Run "yarn add @sendgrid/mail" to enable SendGrid.',
      );
      return;
    }
    if (!this.client) {
      return;
    }

    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'SendGrid not configured. SENDGRID_API_KEY environment variable is required.',
      );
      return;
    }

    this.client.setApiKey(apiKey);
    this.initialized = true;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.initialized) {
      throw new Error('SendGrid client not initialized');
    }

    await this.client!.send({
      to: message.to,
      from: message.from,
      subject: message.subject,
      html: message.html,
      replyTo: message.replyTo,
      attachments: message.attachments?.map((attachment) => ({
        content: attachment.content,
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: attachment.disposition,
        content_id: attachment.contentId,
      })),
    });
  }
}
