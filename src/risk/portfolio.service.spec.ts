import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: PrismaService, useValue: { trade: { findMany } } },
      ],
    }).compile();
    service = module.get<PortfolioService>(PortfolioService);
  });

  it("queries only the user's open trades", async () => {
    findMany.mockResolvedValue([]);
    await service.getSnapshot('user-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'open' } }),
    );
  });

  it('maps execution → direction and sums exposure', async () => {
    findMany.mockResolvedValue([
      {
        id: 't1',
        symbol: 'EURUSD',
        execution: 'buy',
        capitalExposure: 100,
        capitalExposurePct: 1,
      },
      {
        id: 't2',
        symbol: 'USDJPY',
        execution: 'sell',
        capitalExposure: 200,
        capitalExposurePct: 2,
      },
    ]);

    const snapshot = await service.getSnapshot('user-1');

    expect(snapshot.openTradeCount).toBe(2);
    expect(snapshot.totalCapitalExposurePct).toBeCloseTo(3, 6);
    expect(snapshot.totalCapitalExposure).toBeCloseTo(300, 6);
    expect(snapshot.openTrades).toEqual([
      { tradeId: 't1', pair: 'EURUSD', direction: 'long', exposurePct: 1 },
      { tradeId: 't2', pair: 'USDJPY', direction: 'short', exposurePct: 2 },
    ]);
  });

  it('treats null exposure (pre-engine trades) as 0', async () => {
    findMany.mockResolvedValue([
      {
        id: 't1',
        symbol: 'EURUSD',
        execution: 'buy',
        capitalExposure: null,
        capitalExposurePct: null,
      },
    ]);

    const snapshot = await service.getSnapshot('user-1');

    expect(snapshot.totalCapitalExposurePct).toBe(0);
    expect(snapshot.totalCapitalExposure).toBe(0);
    expect(snapshot.openTrades[0].exposurePct).toBe(0);
  });
});
