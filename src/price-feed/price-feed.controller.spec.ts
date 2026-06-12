import { Test, TestingModule } from '@nestjs/testing';
import { PriceFeedController } from './price-feed.controller';
import { PriceFeedService } from './price-feed.service';

describe('PriceFeedController', () => {
  let controller: PriceFeedController;
  let priceFeedService: { addPriceFeedJob: jest.Mock };

  beforeEach(async () => {
    priceFeedService = {
      addPriceFeedJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceFeedController],
      providers: [
        {
          provide: PriceFeedService,
          useValue: priceFeedService,
        },
      ],
    }).compile();

    controller = module.get<PriceFeedController>(PriceFeedController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('queues HTTP price-feed requests with the symbol object payload', async () => {
    const query = { symbol: 'EURUSD' };
    const queuedJob = { id: 'job-1', data: query };
    priceFeedService.addPriceFeedJob.mockResolvedValue(queuedJob);

    await expect(controller.getPriceFeed(query)).resolves.toBe(queuedJob);

    expect(priceFeedService.addPriceFeedJob).toHaveBeenCalledWith(query);
  });
});
