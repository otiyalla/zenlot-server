import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGateway } from './user.gateway';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Mimics Prisma's PrismaPromise, whose `then`/`catch`/`finally` are own
 * enumerable properties. A native Promise has no own properties, so it would
 * hide the case where the query result is spread instead of awaited: spreading
 * a PrismaPromise copies `then`, and an async function returning that object
 * resolves it to the raw row (password hash included).
 */
const prismaPromise = <T>(value: T) => {
  const promise = Promise.resolve(value);
  return {
    then: promise.then.bind(promise) as Promise<T>['then'],
    catch: promise.catch.bind(promise) as Promise<T>['catch'],
    finally: promise.finally.bind(promise) as Promise<T>['finally'],
  };
};

type UserCreateArgs = { data: Record<string, unknown> & { password: string } };

describe('UserService', () => {
  let service: UserService;
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn<PromiseLike<unknown>, [UserCreateArgs]>(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserGateway, useValue: { server: { emit: jest.fn() } } },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateUserDto = {
      fname: 'Ada',
      lname: 'Lovelace',
      email: 'ada@example.com',
      language: 'en',
      role: 'trader',
      accountCurrency: 'USD',
      theme: 'system',
      rules: { forex: { takeProfit: [], stopLoss: [] } },
      password: 'Passw0rd!',
      timezone: 'UTC',
      togglePipValue: false,
      tags: [],
    };

    it('returns the created user with its id and email and without the password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        prismaPromise({ id: 42, ...data }),
      );

      const result = await service.create(dto);

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 42, email: 'ada@example.com' });
      expect(result).not.toHaveProperty('password');
    });

    it('stores a bcrypt hash, not the plain-text password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        prismaPromise({ id: 1, ...data }),
      );

      await service.create(dto);

      const [{ data }] = prisma.user.create.mock.calls[0];
      expect(data.password).not.toBe(dto.password);
      expect(data.password).toMatch(/^\$2[aby]\$10\$/);
    });
  });
});
