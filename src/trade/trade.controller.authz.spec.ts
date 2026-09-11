import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';
import { TradeLogService } from '../risk/trade-log.service';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';

describe('TradeController authorization', () => {
  const tradeService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOneForUser: jest.fn(),
    findByDateRange: jest.fn(),
    findByDateRangeBySymbol: jest.fn(),
    findBySymbol: jest.fn(),
    findByMultipleSymbols: jest.fn(),
    findByMultipleProperties: jest.fn(),
    updateForUser: jest.fn(),
    removeForUser: jest.fn(),
  } as unknown as TradeService;

  const tradeLogService = {
    logTrade: jest.fn(),
    deleteTrade: jest.fn(),
  } as unknown as TradeLogService;

  const controller = new TradeController(tradeService, tradeLogService);
  const req = {
    user: { id: 'owner-1', accountCurrency: 'USD', language: 'en' },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => jest.clearAllMocks());

  it('routes legacy creation through risk sizing and governance', async () => {
    const dto = {
      userId: 'attacker-id',
      symbol: 'EURUSD',
      entry: 1.1,
      execution: 'buy',
      stopLoss: { value: 1.09, pips: 100 },
      takeProfit: { value: 1.12, pips: 200 },
      lot: 99,
      pips: 999,
      accountCurrency: 'EUR',
      exchangeRate: 0.5,
      risk: 1,
      reward: 2,
      status: 'closed_in_profit',
      plainText: 'journal',
      editorState: '{"blocks":[]}',
    };
    await controller.create(dto as never, req);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeService.create).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeLogService.logTrade).toHaveBeenCalledWith(
      'owner-1',
      'USD',
      {
        symbol: 'EURUSD',
        execution: 'buy',
        entry: 1.1,
        stopPrice: 1.09,
        targetPrice: 1.12,
        lot: 99,
        plainText: 'journal',
        editorState: '{"blocks":[]}',
      },
      'en',
    );
  });

  it('propagates governance failures instead of persisting an unchecked trade', async () => {
    const governanceError = new Error('governance blocked');
    (tradeLogService.logTrade as jest.Mock).mockRejectedValueOnce(
      governanceError,
    );
    const dto = {
      symbol: 'EURUSD',
      entry: 1.1,
      execution: 'sell',
      stopLoss: { value: 1.11, pips: 100 },
      takeProfit: { value: 1.08, pips: 200 },
      lot: 0.1,
    };

    await expect(controller.create(dto as never, req)).rejects.toBe(
      governanceError,
    );
    expect(tradeService.create).not.toHaveBeenCalled();
  });

  it('uses request user id for findOne', async () => {
    await controller.findOne('trade-123', req);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeService.findOneForUser).toHaveBeenCalledWith(
      'trade-123',
      'owner-1',
    );
  });

  it('overrides query userId for findAll', async () => {
    const query = { userId: 'attacker-id' };
    await controller.findAll(query as never, req);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1' }),
    );
  });

  it('delegates delete to the risk module with the request user id', async () => {
    await controller.remove('trade-123', req);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeLogService.deleteTrade).toHaveBeenCalledWith(
      'owner-1',
      'trade-123',
    );
  });
});
