import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  const mockPrismaService = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return Zenlot Server message', () => {
      expect(appController.getHello()).toBe('This is Zenlot Server');
    });
  });

  describe('health', () => {
    it('should return ok when database is up', async () => {
      const result = await appController.health();
      expect(result).toEqual({ status: 'ok', database: 'up' });
    });

    it('should throw when database is down', async () => {
      mockPrismaService.$queryRawUnsafe.mockRejectedValueOnce(
        new Error('Connection refused'),
      );
      await expect(appController.health()).rejects.toThrow();
    });
  });
});
