import { Test, TestingModule } from '@nestjs/testing';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';
import { TradeLogService } from '../risk/trade-log.service';

describe('TradeController', () => {
  let controller: TradeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradeController],
      providers: [
        {
          provide: TradeService,
          useValue: {},
        },
        {
          provide: TradeLogService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<TradeController>(TradeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
