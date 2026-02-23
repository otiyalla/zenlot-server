import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PriceFeedService } from './price-feed.service';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from '../quote/quote.service';

describe('PriceFeedService', () => {
  let service: PriceFeedService;

  beforeEach(async () => {
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
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PriceFeedService>(PriceFeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
