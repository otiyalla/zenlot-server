import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PriceFeedService } from './price-feed.service';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from '../quote/quote.service';

describe('PriceFeedService', () => {
  let service: PriceFeedService;
  let priceFeedQueue: { add: jest.Mock };

  beforeEach(async () => {
    priceFeedQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceFeedService,
        {
          provide: PriceFeedGateway,
          useValue: { server: { emit: jest.fn() } },
        },
        {
          provide: QuoteService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: getQueueToken('price-feed'),
          useValue: priceFeedQueue,
        },
      ],
    }).compile();

    service = module.get<PriceFeedService>(PriceFeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('preserves the symbol property when adding a price-feed job', async () => {
    const payload = { symbol: 'EURUSD' };

    await service.addPriceFeedJob(payload);

    expect(priceFeedQueue.add).toHaveBeenCalledWith('price-feed', payload);
  });
});
