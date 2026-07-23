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
    deleteTrade: jest.fn(),
  } as unknown as TradeLogService;

  const controller = new TradeController(tradeService, tradeLogService);
  const req = { user: { id: 'owner-1' } } as unknown as AuthenticatedRequest;

  beforeEach(() => jest.clearAllMocks());

  it('forces request user id on create', async () => {
    const dto = { userId: 'attacker-id', symbol: 'EURUSD' };
    await controller.create(dto as never, req);

    expect(dto.userId).toBe('owner-1');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeService.create).toHaveBeenCalledWith(dto);
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

    expect(query.userId).toBe('owner-1');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tradeService.findAll).toHaveBeenCalledWith(query);
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
