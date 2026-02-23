import { Test, TestingModule } from '@nestjs/testing';
import { PriceFeedGateway } from './price-feed.gateway';
import { AuthService } from '../auth/auth.service';

describe('PriceFeedGateway', () => {
  let gateway: PriceFeedGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceFeedGateway,
        {
          provide: AuthService,
          useValue: {},
        },
      ],
    }).compile();

    gateway = module.get<PriceFeedGateway>(PriceFeedGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
