import { Test, TestingModule } from '@nestjs/testing';
import { PriceFeedController } from './price-feed.controller';

describe('PriceFeedController', () => {
  let controller: PriceFeedController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceFeedController],
    }).compile();

    controller = module.get<PriceFeedController>(PriceFeedController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
