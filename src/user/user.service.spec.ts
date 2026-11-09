import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGateway } from './user.gateway';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

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

  it('ignores a client-supplied role on create so signup cannot create admins', async () => {
    const dto: Partial<CreateUserDto> = {
      fname: 'E2E',
      lname: 'User',
      email: 'e2e@zenlot.com',
      language: 'en',
      role: 'admin',
      accountCurrency: 'USD',
      password: 'password123',
    };
    await service.create(dto as CreateUserDto);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'trader' }),
    });
  });

  it('ignores a client-supplied role on update so users cannot escalate', async () => {
    const dto: Partial<UpdateUserDto> = { role: 'admin', fname: 'New' };
    await service.update(1, dto as UpdateUserDto);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.not.objectContaining({ role: expect.anything() }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ fname: 'New' }),
    });
  });
});
