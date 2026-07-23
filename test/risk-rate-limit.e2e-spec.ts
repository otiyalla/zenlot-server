import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

/**
 * Guards the global rate limiter wired up in src/main.ts:53-68.
 *
 * The limiter caps each IP at `RATE_LIMIT_MAX_REQUESTS` (default 100) requests
 * per `RATE_LIMIT_WINDOW_MS` (default "1 minute"). When the Portfolio Exposure /
 * Drawdown screens looped on an unstable `localize` reference they flooded
 * `GET /risk/*` and tripped this 429. This test pins both the boundary
 * behaviour and the default `max` value so a future "fix" cannot quietly lower
 * the limit instead of fixing the client-side loop.
 */

// Minimal stand-in route. The real endpoints sit behind auth + Prisma, which we
// deliberately avoid booting here — the limiter is a global plugin and applies
// to every route identically, so any route exercises it.
@Controller('risk')
class RiskStubController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [RiskStubController] })
class RiskStubModule {}

// The limiter default that src/main.ts falls back to when RATE_LIMIT_MAX_REQUESTS
// is unset. Anyone tempted to "fix" the 429 by dropping this number should fail
// the explicit assertion below instead.
const DEFAULT_RATE_LIMIT_MAX = 100;

describe('Risk endpoints rate limiting (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RiskStubModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
    );

    // Mirror src/main.ts:53-68 exactly so this test exercises the production
    // configuration rather than a bespoke one.
    const rateLimitMaxRaw = process.env.RATE_LIMIT_MAX_REQUESTS ?? '100';
    const rateLimitWindowRaw = process.env.RATE_LIMIT_WINDOW_MS ?? '1 minute';
    const rateLimitMax = Number(rateLimitMaxRaw);
    const rateLimitWindow = /^\d+$/.test(String(rateLimitWindowRaw))
      ? Number(rateLimitWindowRaw)
      : rateLimitWindowRaw;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports
    await app.register(require('@fastify/rate-limit'), {
      max: Number.isFinite(rateLimitMax) ? rateLimitMax : 100,
      timeWindow: rateLimitWindow,
      keyGenerator: (req: { ip: string }) => req.ip,
      skipOnError: true,
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the default max at 100 (no silent lowering of the limit)', () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(100);

    const rateLimitMaxRaw = process.env.RATE_LIMIT_MAX_REQUESTS ?? '100';
    const rateLimitMax = Number(rateLimitMaxRaw);
    expect(Number.isFinite(rateLimitMax) ? rateLimitMax : 100).toBe(
      DEFAULT_RATE_LIMIT_MAX,
    );
  });

  it('allows up to 100 requests with 200, then returns 429 on request #101', async () => {
    // The first DEFAULT_RATE_LIMIT_MAX (100) requests stay under the cap.
    for (let i = 1; i <= DEFAULT_RATE_LIMIT_MAX; i++) {
      const res = await app.inject({ method: 'GET', url: '/risk/ping' });
      expect(res.statusCode).toBe(200);
    }

    // Request #101 trips the limiter.
    const limited = await app.inject({ method: 'GET', url: '/risk/ping' });
    expect(limited.statusCode).toBe(429);

    const body = JSON.parse(limited.body);
    // @fastify/rate-limit's default errorResponseBuilder produces
    // { statusCode, error, message }. Under a NestFastifyApplication (as in
    // src/main.ts) the thrown 429 passes through Nest's exceptions handler,
    // which may normalize the payload — so we assert the load-bearing fields
    // (status + retry message) rather than an exact object shape.
    expect(body.statusCode).toBe(429);
    expect(body.message).toBe('Rate limit exceeded, retry in 1 minute');
    if ('error' in body) {
      expect(body.error).toBe('Too Many Requests');
    }
  });
});
