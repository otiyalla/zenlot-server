import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

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

  const controller = new TradeController(tradeService);
  const req = { user: { id: 'owner-1' } };

  beforeEach(() => jest.clearAllMocks());

  it('forces request user id on create', async () => {
    const dto: any = { userId: 'attacker-id', symbol: 'EURUSD' };
    await controller.create(dto, req);

    expect(dto.userId).toBe('owner-1');
    expect(tradeService.create).toHaveBeenCalledWith(dto);
  });

  it('uses request user id for findOne', async () => {
    await controller.findOne('trade-123', req);
    expect(tradeService.findOneForUser).toHaveBeenCalledWith(
      'trade-123',
      'owner-1',
    );
  });

  it('overrides query userId for findAll', async () => {
    const query: any = { userId: 'attacker-id' };
    await controller.findAll(query, req);

    expect(query.userId).toBe('owner-1');
    expect(tradeService.findAll).toHaveBeenCalledWith(query);
  });
});
