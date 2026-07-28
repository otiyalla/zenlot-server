import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Socket } from 'socket.io';
import { UserGateway } from './user.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('UserGateway', () => {
  let gateway: UserGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let middleware: (socket: Socket, next: (error?: Error) => void) => void;

  const registerMiddleware = () => {
    const namespace = {
      use: jest.fn(
        (handler: (socket: Socket, next: (error?: Error) => void) => void) => {
          middleware = handler;
        },
      ),
    };
    gateway.afterInit(namespace as unknown as Namespace);
  };

  const connect = (
    handshake: {
      auth?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    } = {},
  ) => {
    const socket = {
      data: {},
      handshake: {
        auth: handshake.auth ?? {},
        headers: handshake.headers ?? {},
      },
      join: jest.fn().mockResolvedValue(undefined),
    };

    return new Promise<{ error?: Error; socket: typeof socket }>((resolve) => {
      middleware(socket as unknown as Socket, (error?: Error) =>
        resolve({ error, socket }),
      );
    });
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ authVersion: 3 }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGateway,
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    gateway = module.get<UserGateway>(UserGateway);
    registerMiddleware();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('rejects a connection with no access token', async () => {
    const { error, socket } = await connect();

    expect(error).toEqual(new Error('Unauthorized'));
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid token', { auth: { accessToken: 'bad-token' } }],
    ['a malformed auth token', { auth: { accessToken: { token: 'bad' } } }],
    ['a malformed bearer header', { headers: { authorization: 'Basic abc' } }],
  ])('rejects %s', async (_label, handshake) => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    const { error, socket } = await connect(handshake);

    expect(error).toEqual(new Error('Unauthorized'));
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects a valid JWT without a string user identity', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 123, authVersion: 3 });

    const { error, socket } = await connect({
      auth: { accessToken: 'valid-token' },
    });

    expect(error).toEqual(new Error('Unauthorized'));
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects an access token after the user auth version changes', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'verified-user',
      authVersion: 2,
    });

    const { error, socket } = await connect({
      auth: { accessToken: 'old-access-token' },
    });

    expect(error).toEqual(new Error('Unauthorized'));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'verified-user' },
      select: { authVersion: true },
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects a legacy access token without an auth version', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'verified-user' });

    const { error, socket } = await connect({
      auth: { accessToken: 'legacy-access-token' },
    });

    expect(error).toEqual(new Error('Unauthorized'));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([
    ['auth accessToken', { auth: { accessToken: 'valid-token' } }],
    ['auth token', { auth: { token: 'valid-token' } }],
    ['bearer header', { headers: { authorization: 'Bearer valid-token' } }],
    ['legacy accessToken header', { headers: { accesstoken: 'valid-token' } }],
  ])(
    'accepts a valid token from %s and joins its verified room',
    async (_label, handshake) => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'verified-user',
        authVersion: 3,
      });

      const { error, socket } = await connect(handshake);

      expect(error).toBeUndefined();
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(socket.data).toEqual({ userId: 'verified-user' });
      expect(socket.join).toHaveBeenCalledWith('user:verified-user');
    },
  );

  it('targets only each requested owner room and allowlists the payload', () => {
    const roomEmits = new Map<string, jest.Mock>();
    const emittedPayloads = new Map<string, unknown>();
    const server = {
      to: jest.fn((room: string) => {
        const emit = jest.fn((event: string, payload: unknown) => {
          if (event === 'updated-user') emittedPayloads.set(room, payload);
        });
        roomEmits.set(room, emit);
        return { emit };
      }),
      emit: jest.fn(),
    };
    gateway.server = server as unknown as Namespace;

    const unsafeUser = {
      id: 'user-1',
      email: 'owner@example.com',
      fname: 'Owner',
      deletedAt: new Date('2026-07-01'),
      deleteScheduledFor: new Date('2026-07-31'),
      daysRemaining: 4,
      password: 'password-hash',
      emailVerificationToken: 'verification-secret',
      emailVerificationTokenExpiry: new Date('2026-08-01'),
      unexpectedPrivateField: 'must-not-leak',
    };

    gateway.emitUserUpdate('user-1', unsafeUser);
    gateway.emitUserUpdate('user-2', { ...unsafeUser, id: 'user-2' });

    expect(server.to).toHaveBeenNthCalledWith(1, 'user:user-1');
    expect(server.to).toHaveBeenNthCalledWith(2, 'user:user-2');
    expect(server.emit).not.toHaveBeenCalled();
    expect(roomEmits.get('user:user-1')).toHaveBeenCalledWith(
      'updated-user',
      expect.objectContaining({
        id: 'user-1',
        email: 'owner@example.com',
        daysRemaining: 4,
      }),
    );
    expect(roomEmits.get('user:user-2')).toHaveBeenCalledWith(
      'updated-user',
      expect.objectContaining({ id: 'user-2' }),
    );

    for (const payload of emittedPayloads.values()) {
      expect(payload).not.toHaveProperty('password');
      expect(payload).not.toHaveProperty('emailVerificationToken');
      expect(payload).not.toHaveProperty('emailVerificationTokenExpiry');
      expect(payload).not.toHaveProperty('unexpectedPrivateField');
    }
  });
});
