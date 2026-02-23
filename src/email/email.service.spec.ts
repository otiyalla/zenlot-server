import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let configService: ConfigService;
  let transport: { send: jest.Mock };

  beforeEach(() => {
    const configValues = {
      EMAIL_FROM: 'noreply@zenlot.app',
      SUPPORT_EMAIL: 'support@zenlot.app',
      FEEDBACK_EMAIL_RECIPIENT: 'feedback@zenlot.app',
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key in configValues) {
          return configValues[key as keyof typeof configValues];
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    transport = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    service = new EmailService(configService, transport);
  });

  it('sendWelcomeEmail sends English content for en language', async () => {
    const result = await service.sendWelcomeEmail(
      'user@example.com',
      'John',
      'Doe',
      'en',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe(
      "You're in! Here's what you can do next with Zenlot John",
    );
    expect(message.html).toContain('Welcome to Zenlot, John!');
  });

  it('sendWelcomeEmail sends French content for fr language', async () => {
    const result = await service.sendWelcomeEmail(
      'user@example.com',
      'Jean',
      'Dupont',
      'fr',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe(
      'Bienvenue sur Zenlot : prochaines etapes pour Jean',
    );
    expect(message.html).toContain('Bienvenue sur Zenlot, Jean!');
  });

  it('sendPasswordResentEmail falls back to English for unsupported language', async () => {
    const result = await service.sendPasswordResentEmail(
      'user@example.com',
      'tPass123456',
      'John',
      'es',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe('Password Reset Confirmation - Zenlot');
    expect(message.html).toContain(
      'Your password has been <strong>successfully reset</strong>',
    );
  });

  it('sendAccountDeletionNotice localizes subject and ICS content for French', async () => {
    const result = await service.sendAccountDeletionNotice(
      'user@example.com',
      'Jean Dupont',
      'fr',
      30,
      'UTC',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe(
      'Action requise : avis de suppression de compte',
    );
    expect(message.html).toContain('Suppression du compte planifiee');

    const attachment = message.attachments?.[0];
    expect(attachment).toBeDefined();

    const icsBody = Buffer.from(attachment.content, 'base64').toString('utf8');
    expect(icsBody).toContain('SUMMARY:Suppression du compte Zenlot');
    expect(icsBody).toContain(
      'DESCRIPTION:Votre compte Zenlot est planifie pour suppression',
    );
  });

  it('sendAccountDeletionCancelledNotice localizes subject and body for French', async () => {
    const result = await service.sendAccountDeletionCancelledNotice(
      'user@example.com',
      'Jean Dupont',
      'fr',
      'UTC',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe('Suppression du compte annulee - Zenlot');
    expect(message.html).toContain('Suppression du compte annulee');
    expect(message.html).toContain("Heure d'annulation");
  });
});
