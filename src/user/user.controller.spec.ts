import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';

/**
 * Exercises the global AuthGuard plus the ownership checks in UserController
 * over HTTP, on the Fastify adapter used in production, with token
 * verification and UserService mocked.
 */
describe('UserController (HTTP)', () => {
  let app: NestFastifyApplication;

  const userService = {
    create: jest.fn(),
    changePassword: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const users: Record<string, object> = {
    'alice-token': { id: 2, email: 'alice@zenlot.com', role: 'trader' },
    'bob-token': { id: 3, email: 'bob@zenlot.com', role: 'trader' },
    'admin-token': { id: 1, email: 'admin@zenlot.com', role: 'admin' },
  };
  const authService = {
    verify: jest.fn((token: string) => Promise.resolve(users[token] ?? null)),
  };

  const as = (token: string) => ({ access_token: token });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: AuthService, useValue: authService },
        { provide: JwtService, useValue: {} },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

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
    jest.clearAllMocks();
    userService.findOne.mockResolvedValue({ id: 2, email: 'alice@zenlot.com' });
    userService.update.mockResolvedValue({ id: 2, fname: 'Alice' });
    userService.remove.mockResolvedValue({
      id: 2,
      deleted: { journals: 0, trades: 0, refreshTokens: 0 },
    });
    userService.changePassword.mockResolvedValue(true);
  });

  const server = () => app.getHttpServer();

  it('rejects requests without a token', async () => {
    await request(server()).get('/user/2').expect(401);
    expect(userService.findOne).not.toHaveBeenCalled();
  });

  describe('GET /user', () => {
    it('no longer exposes a list of every user', async () => {
      await request(server()).get('/user').set(as('admin-token')).expect(404);
      await request(server()).get('/user').set(as('alice-token')).expect(404);
    });
  });

  describe('GET /user/:id', () => {
    it('lets a user read their own account', async () => {
      const res = await request(server())
        .get('/user/2')
        .set(as('alice-token'))
        .expect(200);
      expect(userService.findOne).toHaveBeenCalledWith(2);
      expect(res.body).toEqual({ id: 2, email: 'alice@zenlot.com' });
    });

    it("forbids reading another user's account", async () => {
      await request(server()).get('/user/2').set(as('bob-token')).expect(403);
      expect(userService.findOne).not.toHaveBeenCalled();
    });

    it('lets an admin read any account', async () => {
      await request(server()).get('/user/2').set(as('admin-token')).expect(200);
      expect(userService.findOne).toHaveBeenCalledWith(2);
    });

    it('rejects a non-numeric id', async () => {
      await request(server())
        .get('/user/abc')
        .set(as('alice-token'))
        .expect(400);
      expect(userService.findOne).not.toHaveBeenCalled();
    });
  });

  describe('PUT /user/:id', () => {
    // UpdateUserDto currently requires both timestamps.
    const stamps = {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('lets a user update their own account', async () => {
      await request(server())
        .put('/user/2')
        .set(as('alice-token'))
        .send({ ...stamps, fname: 'Alice' })
        .expect(200);
      expect(userService.update).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ fname: 'Alice' }),
      );
    });

    it("forbids updating another user's account", async () => {
      await request(server())
        .put('/user/2')
        .set(as('bob-token'))
        .send({ ...stamps, fname: 'Hacked' })
        .expect(403);
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('lets an admin update any account', async () => {
      await request(server())
        .put('/user/2')
        .set(as('admin-token'))
        .send({ ...stamps, fname: 'Alice' })
        .expect(200);
      expect(userService.update).toHaveBeenCalledWith(2, expect.anything());
    });
  });

  describe('DELETE /user/:id', () => {
    it('lets a user delete their own account', async () => {
      await request(server())
        .delete('/user/2')
        .set(as('alice-token'))
        .expect(200);
      expect(userService.remove).toHaveBeenCalledWith(2);
    });

    it("forbids deleting another user's account", async () => {
      await request(server())
        .delete('/user/2')
        .set(as('bob-token'))
        .expect(403);
      expect(userService.remove).not.toHaveBeenCalled();
    });

    it('lets an admin delete any account', async () => {
      await request(server())
        .delete('/user/2')
        .set(as('admin-token'))
        .expect(200);
      expect(userService.remove).toHaveBeenCalledWith(2);
    });
  });

  describe('POST /user/change-password', () => {
    const passwords = {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    };

    it('uses the authenticated user when no userId is sent', async () => {
      await request(server())
        .post('/user/change-password')
        .set(as('alice-token'))
        .send(passwords)
        .expect(201);
      expect(userService.changePassword).toHaveBeenCalledWith(
        2,
        expect.objectContaining(passwords),
      );
    });

    it("accepts the caller's own userId (as the mobile client sends it)", async () => {
      await request(server())
        .post('/user/change-password')
        .set(as('alice-token'))
        .send({ ...passwords, userId: '2' })
        .expect(201);
      expect(userService.changePassword).toHaveBeenCalledWith(
        2,
        expect.anything(),
      );
    });

    it("forbids changing another user's password", async () => {
      await request(server())
        .post('/user/change-password')
        .set(as('bob-token'))
        .send({ ...passwords, userId: 2 })
        .expect(403);
      expect(userService.changePassword).not.toHaveBeenCalled();
    });

    it('lets an admin target another user', async () => {
      await request(server())
        .post('/user/change-password')
        .set(as('admin-token'))
        .send({ ...passwords, userId: 2 })
        .expect(201);
      expect(userService.changePassword).toHaveBeenCalledWith(
        2,
        expect.anything(),
      );
    });
  });
});
