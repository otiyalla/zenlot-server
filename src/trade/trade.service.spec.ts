import { Test, TestingModule } from '@nestjs/testing';
import { TradeService } from './trade.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiskCalculationService } from '../risk/risk-calculation.service';
import { TradeLogService } from '../risk/trade-log.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';

describe('TradeService', () => {
  let service: TradeService;
  let create: jest.Mock;
  let update: jest.Mock;
  let findFirst: jest.Mock;
  let findMany: jest.Mock;
  let calculate: jest.Mock;
  let validateActiveTradeGeometry: jest.Mock;
  let settleManualClose: jest.Mock;

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
    findMany = jest.fn().mockResolvedValue([]);
    calculate = jest.fn();
    validateActiveTradeGeometry = jest.fn();
    settleManualClose = jest.fn().mockResolvedValue({ id: 't1' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        {
          provide: PrismaService,
          useValue: { trade: { create, update, findFirst, findMany } },
        },
        {
          provide: RiskCalculationService,
          useValue: {
            calculateActiveTrade: calculate,
            validateActiveTradeGeometry,
          },
        },
        { provide: TradeLogService, useValue: { settleManualClose } },
      ],
    }).compile();

    service = module.get<TradeService>(TradeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('includes the full date-only end day in date-range queries', async () => {
    await service.findByDateRange({
      userId: 'u1',
      start: '2026-07-27',
      end: '2026-07-27',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        createdAt: {
          gte: new Date('2026-07-27'),
          lte: new Date('2026-07-27T23:59:59.999Z'),
        },
      },
    });
  });

  it('preserves explicit end instants in trade searches', async () => {
    await service.search({
      userId: 'u1',
      end: '2026-07-27T14:30:00.000Z',
    } as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            lte: new Date('2026-07-27T14:30:00.000Z'),
          }),
        }),
      }),
    );
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
      rr: 2,
      stopLoss: { value: 1.09, pips: 10 },
      takeProfit: { value: 1.12, pips: 20 },
    };

    beforeEach(() => {
      findFirst.mockResolvedValue(openTracked);
    });

    it.each([
      ['buy', 1.095, 1.12],
      ['sell', 1.105, 1.08],
    ] as const)(
      'recomputes a tracked open %s trailing stop without overwriting planned rr',
      async (execution, stopPrice, targetPrice) => {
        findFirst.mockResolvedValue({
          ...openTracked,
          execution,
          stopLoss: {
            value: execution === 'buy' ? 1.09 : 1.11,
            pips: 100,
          },
          takeProfit: { value: targetPrice, pips: 200 },
        });
        calculate.mockResolvedValue({
          actualCapitalExposure: 50,
          capitalExposurePct: 1.5,
          rewardToRisk: 4,
          rewardPips: 200,
          pipValue: 10,
          stopPrice,
          stopDistancePips: 50,
          targetPrice,
          lotSizeRounded: 0.1,
          exchangeRate: 1,
        });

        await service.updateForUser('t1', 'u1', {
          id: 't1',
          rr: 99,
          stopLoss: { value: stopPrice, pips: 1 },
        } as unknown as UpdateTradeDto);

        const data = dataOf(update);
        expect(calculate).toHaveBeenCalledTimes(1);
        expect(data).not.toHaveProperty('rr');
        expect(data).toMatchObject({
          lot: 0.1,
          exchangeRate: 1,
          risk: 50,
          reward: 200,
          capitalExposure: 50,
          capitalExposurePct: 1.5,
          stopLoss: { value: stopPrice, pips: 50 },
          takeProfit: { value: targetPrice, pips: 200 },
        });
      },
    );

    it.each([
      ['buy', 1.105, 1.12],
      ['sell', 1.095, 1.08],
    ] as const)(
      'supports a tracked open %s trade with a profit-lock stop and profitable target',
      async (execution, stopPrice, targetPrice) => {
        findFirst.mockResolvedValue({
          ...openTracked,
          execution,
          stopLoss: {
            value: execution === 'buy' ? 1.09 : 1.11,
            pips: 10,
          },
          takeProfit: { value: targetPrice, pips: 20 },
        });
        calculate.mockResolvedValue({
          actualCapitalExposure: 0,
          capitalExposurePct: 0,
          rewardToRisk: null,
          rewardPips: 200,
          pipValue: 10,
          stopPrice,
          stopDistancePips: 50,
          targetPrice,
          lotSizeRounded: 0.1,
          exchangeRate: 1,
        });

        await service.updateForUser('t1', 'u1', {
          id: 't1',
          stopLoss: { value: stopPrice, pips: 1 },
          takeProfit: { value: targetPrice, pips: 1 },
        } as unknown as UpdateTradeDto);

        expect(calculate).toHaveBeenCalledWith('u1', 'USD', {
          symbol: 'EURUSD',
          execution,
          entry: 1.1,
          stopPrice,
          targetPrice,
          lot: 0.1,
        });
        const data = dataOf(update);
        expect(data).not.toHaveProperty('rr');
        expect(data).toMatchObject({
          lot: 0.1,
          exchangeRate: 1,
          risk: 0,
          reward: 200,
          capitalExposure: 0,
          capitalExposurePct: 0,
          stopLoss: { value: stopPrice, pips: 50 },
          takeProfit: { value: targetPrice, pips: 200 },
        });
      },
    );

    it('does not recompute when no risk-affecting field changed', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        tags: ['review'],
        rr: 99,
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
      expect(dataOf(update)).not.toHaveProperty('capitalExposure');
      expect(dataOf(update)).not.toHaveProperty('rr');
    });

    it('does not recompute a legacy trade with no tracked exposure', async () => {
      findFirst.mockResolvedValue({ ...openTracked, capitalExposurePct: null });
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        stopLoss: { value: 1.085, pips: 15 },
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
      expect(validateActiveTradeGeometry).toHaveBeenCalled();
    });

    it('does not persist invalid active geometry for a legacy trade', async () => {
      findFirst.mockResolvedValue({ ...openTracked, capitalExposurePct: null });
      validateActiveTradeGeometry.mockImplementation(() => {
        throw new Error('invalid stop/target ordering');
      });

      await expect(
        service.updateForUser('t1', 'u1', {
          id: 't1',
          stopLoss: { value: 1.125, pips: 25 },
        } as unknown as UpdateTradeDto),
      ).rejects.toThrow('invalid stop/target ordering');
      expect(calculate).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('does not recompute when the trade is being closed', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        status: 'closed_in_profit',
        entry: 1.105,
      } as unknown as UpdateTradeDto);
      expect(calculate).not.toHaveBeenCalled();
    });

    it('does not save a tracked edit when risk recomputation fails', async () => {
      calculate.mockRejectedValue(new Error('balance unset'));
      await expect(
        service.updateForUser('t1', 'u1', {
          id: 't1',
          entry: 1.105,
        } as unknown as UpdateTradeDto),
      ).rejects.toThrow('balance unset');
      expect(update).not.toHaveBeenCalled();
    });

    it('does not persist a target at/below a trailed long stop', async () => {
      calculate.mockRejectedValue(new Error('invalid stop/target ordering'));
      await expect(
        service.updateForUser('t1', 'u1', {
          id: 't1',
          stopLoss: { value: 1.105, pips: 5 },
          takeProfit: { value: 1.102, pips: 2 },
        } as unknown as UpdateTradeDto),
      ).rejects.toThrow('invalid stop/target ordering');
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('updateForUser settling close', () => {
    const openTrade = {
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
      findFirst.mockResolvedValue(openTrade);
    });

    it.each(['closed_in_profit', 'closed_in_loss', 'reached_tp', 'reached_sl'])(
      'settles PnL when an open trade moves to %s',
      async (status) => {
        await service.updateForUser('t1', 'u1', {
          id: 't1',
          status,
          closedPrice: 1.12,
        } as unknown as UpdateTradeDto);

        expect(settleManualClose).toHaveBeenCalledTimes(1);
        const [userId, existing, data, exitPrice] =
          settleManualClose.mock.calls[0];
        expect(userId).toBe('u1');
        expect(existing.id).toBe('t1');
        expect((data as Record<string, unknown>).status).toBe(status);
        expect(exitPrice).toBe(1.12);
        // The plain update path is bypassed for a settling close.
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('does not allow account currency changes through a closing update', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        status: 'closed_in_profit',
        closedPrice: 1.12,
        accountCurrency: 'EUR',
      } as unknown as UpdateTradeDto);

      const [, , data] = settleManualClose.mock.calls[0] as unknown as [
        string,
        unknown,
        Record<string, unknown>,
      ];
      expect(data).not.toHaveProperty('accountCurrency');
    });

    it('does NOT settle a neutral close (by design)', async () => {
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        status: 'closed',
        closedPrice: 1.105,
      } as unknown as UpdateTradeDto);
      expect(settleManualClose).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('does NOT settle when the trade was already closed', async () => {
      findFirst.mockResolvedValue({
        ...openTrade,
        status: 'closed_in_profit',
      });
      await service.updateForUser('t1', 'u1', {
        id: 't1',
        status: 'reached_tp',
        closedPrice: 1.12,
      } as unknown as UpdateTradeDto);
      expect(settleManualClose).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
