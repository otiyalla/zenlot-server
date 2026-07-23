import { Test, TestingModule } from '@nestjs/testing';
import { TradeService } from './trade.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiskCalculationService } from '../risk/risk-calculation.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';

describe('TradeService', () => {
  let service: TradeService;
  let create: jest.Mock;
  let update: jest.Mock;
  let findFirst: jest.Mock;
  let calculate: jest.Mock;

  const dataOf = (mock: jest.Mock): Record<string, unknown> => {
    const calls = mock.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    return calls[0][0].data;
  };

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: 't1' });
    update = jest.fn().mockResolvedValue({ id: 't1' });
    findFirst = jest.fn();
    calculate = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        {
          provide: PrismaService,
          useValue: { trade: { create, update, findFirst } },
        },
        { provide: RiskCalculationService, useValue: { calculate } },
      ],
    }).compile();

    service = module.get<TradeService>(TradeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const createDto = {
    userId: 'u1',
    symbol: 'EURUSD',
    entry: 1.1,
    lot: 0.1,
    pips: 10,
    execution: 'buy',
    accountCurrency: 'USD',
    exchangeRate: 1,
    stopLoss: { value: 1.09, pips: 10 },
    takeProfit: { value: 1.11, pips: 10 },
    status: 'open',
  } as unknown as CreateTradeDto;

  it('forces isAutoClosed to false on create, ignoring a client-sent true', async () => {
    await service.create({
      ...createDto,
      isAutoClosed: true,
    } as CreateTradeDto);
    expect(dataOf(create).isAutoClosed).toBe(false);
  });

  it('never lets a client update isAutoClosed', async () => {
    await service.update('t1', {
      id: 't1',
      isAutoClosed: true,
      status: 'closed',
    } as unknown as UpdateTradeDto);
    expect(dataOf(update)).not.toHaveProperty('isAutoClosed');
  });

  describe('updateForUser exposure recompute', () => {
    // A risk-engine-tracked open trade (has capitalExposurePct).
    const openTracked = {
      id: 't1',
      userId: 'u1',
      status: 'open',
      symbol: 'EURUSD',
      execution: 'buy',
      entry: 1.1,
      lot: 0.1,
      accountCurrency: 'USD',
      capitalExposurePct: 1,
      stopLoss: { value: 1.09, pips: 10 },
      takeProfit: { value: 1.12, pips: 20 },
    };

    beforeEach(() => {
      findFirst.mockResolvedValue(openTracked);
    });

    it('recomputes exposure when an open trade stop is edited', async () => {
      calculate.mockResolvedValue({
        calculation: {
          actualCapitalExposure: 42,
          capitalExposurePct: 2.5,
          rewardToRisk: 3,
          rewardPips: 30,
          stopPrice: 1.085,
          stopDistancePips: 15,
          targetPrice: 1.12,
          lotSizeRounded: 0.1,
          exchangeRate: 1,
        },
      });

      await service.updateForUser('t1', 'u1', {
        id: 't1',
        stopLoss: { value: 1.085, pips: 15 },
      } as unknown as UpdateTradeDto);

      const data = dataOf(update);
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(data.capitalExposure).toBe(42);
      expect(data.capitalExposurePct).toBe(2.5);
      expect(data.risk).toBe(42);
      expect(data.stopLoss).toEqual({ value: 1.085, pips: 15 });
    });

    it('does not recompute when no risk-affecting field changed', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        tags: ['review'],
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
      expect(dataOf(update)).not.toHaveProperty('capitalExposure');
    });

    it('does not recompute a legacy trade with no tracked exposure', async () => {
      findFirst.mockResolvedValue({ ...openTracked, capitalExposurePct: null });
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        stopLoss: { value: 1.085, pips: 15 },
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
    });

    it('does not recompute when the trade is being closed', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        status: 'closed_in_profit',
        entry: 1.105,
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
    });

    it('still saves the edit when sizing fails', async () => {
      calculate.mockRejectedValue(new Error('balance unset'));
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        entry: 1.105,
      } as unknown as UpdateTradeDto);
      // Edit is persisted; exposure fields are simply omitted.
      expect(update).toHaveBeenCalledTimes(1);
      expect(dataOf(update)).not.toHaveProperty('capitalExposure');
    });
  });
});
