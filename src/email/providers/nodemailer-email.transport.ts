import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import {
  EmailMessage,
  EmailTransport,
} from '../interfaces/email-transport.interface';

@Injectable()
export class NodemailerEmailTransport implements EmailTransport {
  private readonly logger = new Logger(NodemailerEmailTransport.name);
  private transporter: Transporter | undefined;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const emailUser = this.configService.get<string>('SMTP_USER');
    const emailPassword = this.configService.get<string>('SMTP_PASSWORD');
    const emailHost =
      this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const emailPort = this.configService.get<number>('SMTP_PORT') || 587;

    if (!emailUser || !emailPassword) {
      this.logger.warn(
        'Nodemailer not configured. EMAIL_USER and EMAIL_PASSWORD are required.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: emailHost,
      port: emailPort,
      secure: Number(emailPort) === 465,
      auth: {
        user: emailUser,
        pass: emailPassword,
      },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('Nodemailer transporter not initialized');
    }

    await this.transporter.sendMail({
      ...message,
      attachments: message.attachments,
    });
  }
}
