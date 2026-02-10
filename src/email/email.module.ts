import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import {
  EMAIL_TRANSPORT,
  EmailMessage,
  EmailTransport,
} from './interfaces/email-transport.interface';
import { NodemailerEmailTransport } from './providers/nodemailer-email.transport';
import { SendGridEmailTransport } from './providers/sendgrid-email.transport';

@Module({
  providers: [
    NodemailerEmailTransport,
    SendGridEmailTransport,
    {
      provide: EMAIL_TRANSPORT,
      inject: [ConfigService, NodemailerEmailTransport, SendGridEmailTransport],
      useFactory: (
        configService: ConfigService,
        nodemailerTransport: NodemailerEmailTransport,
        sendGridTransport: SendGridEmailTransport,
      ): EmailTransport => {
        const logger = new Logger('EmailTransportFactory');
        const provider = (
          configService.get<string>('EMAIL_PROVIDER') || 'nodemailer'
        ).toLowerCase();
        
        const emailFrom = configService.get<string>('EMAIL_FROM');

        if (!emailFrom) {
          throw new Error('EMAIL_FROM is required for email delivery');
        }

        if (provider === 'nodemailer') {
          const emailUser = configService.get<string>('SMTP_USER');
          const emailPassword = configService.get<string>('SMTP_PASSWORD');
          if (!emailUser || !emailPassword) {
            throw new Error(
              'EMAIL_USER and EMAIL_PASSWORD are required when EMAIL_PROVIDER=nodemailer',
            );
          }
        }

        if (provider === 'sendgrid') {
          const apiKey = configService.get<string>('SENDGRID_API_KEY');
          if (!apiKey) {
            throw new Error(
              'SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid',
            );
          }
        }

        const primaryTransport =
          provider === 'nodemailer' ? nodemailerTransport : sendGridTransport;
        const fallbackTransport =
          provider === 'nodemailer' ? sendGridTransport : nodemailerTransport;

        return {
          async send(message: EmailMessage): Promise<void> {
            try {
              await primaryTransport.send(message);
            } catch (primaryError) {
              logger.error(
                `Primary email provider "${provider}" failed, trying fallback transport`,
                primaryError as Error,
              );
              await fallbackTransport.send(message);
            }
          },
        };
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
