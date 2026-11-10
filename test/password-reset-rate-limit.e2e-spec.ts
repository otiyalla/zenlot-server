import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  AuthController,
  PASSWORD_RESET_CONFIRM_RATE_LIMIT,
  PASSWORD_RESET_RATE_LIMIT,
} from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

// Only the DI token is needed; the real module drags in ESM-only deps
// (expo-server-sdk) that the e2e Jest config does not transform.
jest.mock('../src/auth/auth.service', () => ({ AuthService: class {} }));

/**
 * The public password-reset routes email arbitrary addresses (and redeem reset
 * links), so they carry a much stricter per-IP limit than the global limiter
 * (src/main.ts), via route-level config on the real AuthController. The service
 * is stubbed: only the routing + limiter wiring is under test.
 */
describe('Password reset rate limiting (e2e)', () => {
  let app: NestFastifyApplication;
  const authService = {
    requestPasswordReset: jest.fn().mockResolvedValue(true),
    confirmPasswordReset: jest.fn().mockResolvedValue(true),
    signin: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
    );
    // Same global registration as src/main.ts.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports
    await app.register(require('@fastify/rate-limit'), {
      max: 100,
      timeWindow: '1 minute',
      keyGenerator: (req: { ip: string }) => req.ip,
      skipOnError: true,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (url: string, ip: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'x-forwarded-for': ip },
      payload: { email: 'jane@example.com', password: 'pw', token: 't' },
    });

  it.each(['/auth/resetpassword', '/auth/forgotpassword'])(
    'caps %s per IP at the reset limit',
    async (url) => {
      const ip = url === '/auth/resetpassword' ? '10.0.0.1' : '10.0.0.2';
      for (let i = 0; i < PASSWORD_RESET_RATE_LIMIT.max; i += 1) {
        expect((await post(url, ip)).statusCode).toBe(200);
      }
      expect((await post(url, ip)).statusCode).toBe(429);
      // Another client is unaffected.
      expect((await post(url, '10.0.0.99')).statusCode).toBe(200);
    },
  );

  it('caps reset link redemption per IP at its own limit', async () => {
    const url = '/auth/resetpassword/confirm';
    for (let i = 0; i < PASSWORD_RESET_CONFIRM_RATE_LIMIT.max; i += 1) {
      expect((await post(url, '10.0.0.4')).statusCode).toBe(200);
    }
    expect((await post(url, '10.0.0.4')).statusCode).toBe(429);
    expect((await post(url, '10.0.0.98')).statusCode).toBe(200);
  });

  it('leaves other auth routes on the general limit', async () => {
    for (let i = 0; i < PASSWORD_RESET_RATE_LIMIT.max + 3; i += 1) {
      expect((await post('/auth/signin', '10.0.0.3')).statusCode).toBe(200);
    }
  });
});
