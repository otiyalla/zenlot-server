import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';

/**
 * Exercises the real guard chain (global AuthGuard -> RolesGuard) over HTTP,
 * on the Fastify adapter used in production, with token verification and the
 * database layer mocked.
 */
describe('AdminController (HTTP)', () => {
  let app: NestFastifyApplication;
  const adminService = {
    hardDeleteUser: jest.fn(),
    findUsers: jest.fn(),
  };
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
  const TARGET_ID = '00000000-0000-4000-8000-000000000042';
  const users: Record<string, object> = {
    'admin-token': { id: ADMIN_ID, email: 'admin@zenlot.com', role: 'admin' },
    'trader-token': {
      id: '00000000-0000-4000-8000-000000000002',
      email: 'trader@zenlot.com',
      role: 'trader',
    },
  };
  const authService = {
    verifyToken: jest.fn((token: string) =>
      Promise.resolve(users[token] ?? null),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: AuthService, useValue: authService },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    // Use Fastify, like main.ts, so DELETE request bodies are parsed the same way as in production.
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Mirror the global pipe configured in main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    adminService.hardDeleteUser.mockReset();
    adminService.findUsers.mockReset();
  });

  describe('DELETE /admin/users/:id', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/users/${TARGET_ID}`)
        .send({ confirmEmail: 'e2e@zenlot.com' })
        .expect(401);
      expect(adminService.hardDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-admin user', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/users/${TARGET_ID}`)
        .set('accesstoken', 'trader-token')
        .send({ confirmEmail: 'e2e@zenlot.com' })
        .expect(403);
      expect(adminService.hardDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 400 when confirmEmail is missing', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/users/${TARGET_ID}`)
        .set('accesstoken', 'admin-token')
        .send({})
        .expect(400);
      expect(adminService.hardDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 400 when the id is not a UUID', async () => {
      await request(app.getHttpServer())
        .delete('/admin/users/42')
        .set('accesstoken', 'admin-token')
        .send({ confirmEmail: 'e2e@zenlot.com' })
        .expect(400);
      expect(adminService.hardDeleteUser).not.toHaveBeenCalled();
    });

    it('deletes the user for an admin and passes the admin as the actor', async () => {
      const result = {
        id: TARGET_ID,
        email: 'e2e@zenlot.com',
        deleted: { journals: 0, trades: 1, refreshTokens: 2, feedback: 0 },
        detachedJournals: 0,
      };
      adminService.hardDeleteUser.mockResolvedValue(result);

      const res = await request(app.getHttpServer())
        .delete(`/admin/users/${TARGET_ID}`)
        .set('accesstoken', 'admin-token')
        .send({ confirmEmail: 'e2e@zenlot.com' })
        .expect(200);

      expect(res.body).toEqual(result);
      expect(adminService.hardDeleteUser).toHaveBeenCalledWith(
        TARGET_ID,
        'e2e@zenlot.com',
        { id: ADMIN_ID, email: 'admin@zenlot.com' },
        expect.objectContaining({ ipAddress: expect.any(String) }),
      );
    });
  });

  describe('GET /admin/users', () => {
    it('returns 403 for a non-admin user', async () => {
      await request(app.getHttpServer())
        .get('/admin/users?email=e2e')
        .set('accesstoken', 'trader-token')
        .expect(403);
      expect(adminService.findUsers).not.toHaveBeenCalled();
    });

    it('returns matching users for an admin', async () => {
      adminService.findUsers.mockResolvedValue([
        { id: TARGET_ID, email: 'e2e@zenlot.com' },
      ]);

      const res = await request(app.getHttpServer())
        .get('/admin/users?email=e2e')
        .set('accesstoken', 'admin-token')
        .expect(200);

      expect(res.body).toEqual([{ id: TARGET_ID, email: 'e2e@zenlot.com' }]);
      expect(adminService.findUsers).toHaveBeenCalledWith('e2e');
    });
  });
});
