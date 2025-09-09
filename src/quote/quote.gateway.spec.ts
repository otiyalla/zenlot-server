import { Test, TestingModule } from '@nestjs/testing';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';

describe('QuoteGateway', () => {
  let gateway: QuoteGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuoteGateway, QuoteService],
    }).compile();

    gateway = module.get<QuoteGateway>(QuoteGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
