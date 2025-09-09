import { Test, TestingModule } from '@nestjs/testing';
import { PriceFeedGateway } from './price-feed.gateway';
import { PriceFeedService } from './price-feed.service';

describe('PriceFeedGateway', () => {
  let gateway: PriceFeedGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceFeedGateway, PriceFeedService],
    }).compile();

    gateway = module.get<PriceFeedGateway>(PriceFeedGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
