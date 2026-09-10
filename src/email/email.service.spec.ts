/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
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
      "Welcome to Zenlot, John — let's build your trading discipline",
    );
    expect(message.html).toContain('Welcome to Zenlot, John!');
    // Repositioned around the discipline/risk OS + a primary CTA button.
    expect(message.html).toContain('risk-management OS');
    expect(message.html).toContain('Open Zenlot');
    // CTA deep-links into the app (custom scheme → Home via the auth gate).
    expect(message.html).toContain('href="zenlot://"');
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
      'Bienvenue sur Zenlot, Jean — bâtissons votre discipline de trading',
    );
    expect(message.html).toContain('Bienvenue sur Zenlot, Jean!');
    // French copy now uses proper accents + the CTA button.
    expect(message.html).toContain('Ouvrir Zenlot');
    expect(message.html).toContain('gestion du risque');
  });

  it('sendWelcomeEmail sends gender-neutral Spanish content for es language', async () => {
    const result = await service.sendWelcomeEmail(
      'user@example.com',
      'Ana',
      'Garcia',
      'es',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe(
      'Te damos la bienvenida a Zenlot, Ana \u2014 construyamos tu disciplina de trading',
    );
    expect(message.html).toContain('Te damos la bienvenida a Zenlot');
    // "Bienvenido" is masculine and misgenders most recipients; the greeting
    // must stay neutral.
    expect(message.subject).not.toContain('Bienvenido');
    expect(message.html).not.toContain('Bienvenido');
  });

  it('sendWelcomeEmail resolves a regional Spanish tag to Spanish', async () => {
    const result = await service.sendWelcomeEmail(
      'user@example.com',
      'Ana',
      'Garcia',
      'es-419',
    );

    expect(result).toBe(true);

    const message = transport.send.mock.calls[0][0];
    expect(message.html).toContain('Te damos la bienvenida a Zenlot');
  });

  it('sendWelcomeEmail does not treat a lookalike tag as Spanish', async () => {
    // 'est' is Estonian; it only shares a prefix with 'es'.
    const result = await service.sendWelcomeEmail(
      'user@example.com',
      'John',
      'Doe',
      'est',
    );

    expect(result).toBe(true);

    const message = transport.send.mock.calls[0][0];
    expect(message.html).toContain('Welcome to Zenlot, John!');
  });

  it('sendPasswordResentEmail sends Spanish content for es language', async () => {
    const result = await service.sendPasswordResentEmail(
      'user@example.com',
      'tPass123456',
      'John',
      'es',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe(
      'Confirmación de restablecimiento de contraseña - Zenlot',
    );
    expect(message.html).toContain(
      'Tu contraseña se ha <strong>restablecido correctamente</strong>',
    );
  });

  it('sendPasswordResentEmail falls back to English for unsupported language', async () => {
    const result = await service.sendPasswordResentEmail(
      'user@example.com',
      'tPass123456',
      'John',
      'de',
    );

    expect(result).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(1);

    const message = transport.send.mock.calls[0][0];
    expect(message.subject).toBe('Password Reset Confirmation - Zenlot');
    expect(message.html).toContain(
      'Your password has been <strong>successfully reset</strong>',
    );
  });

  it('escapes untrusted feedback fields before inserting them into HTML', async () => {
    await service.sendFeedbackEmail(
      'attacker@example.com" onmouseover="alert(1)',
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>\n<img src=x onerror=alert(2)>',
      '<a href="javascript:alert(3)">bug</a>',
    );

    const message = transport.send.mock.calls[0][0];
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(message.html).toContain(
      'attacker@example.com&quot; onmouseover=&quot;alert(1)',
    );
    expect(message.html).toContain(
      '&lt;a href=&quot;javascript:alert(3)&quot;&gt;',
    );
    expect(message.html).not.toContain('<script>alert(1)</script>');
    expect(message.html).not.toContain('<img src=x onerror=alert(2)>');
  });

  it('preserves ordinary feedback text and line breaks after escaping', async () => {
    await service.sendFeedbackEmail(
      'trader@example.com',
      'Great feature',
      'Please add dark mode.\nThank you!',
      'feature',
    );

    const message = transport.send.mock.calls[0][0];
    expect(message.html).toContain('Great feature');
    expect(message.html).toContain('Please add dark mode.<br/>Thank you!');
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
