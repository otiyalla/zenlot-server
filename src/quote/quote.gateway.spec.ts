import { Test, TestingModule } from '@nestjs/testing';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';
import { AuthService } from '../auth/auth.service';

describe('QuoteGateway', () => {
  let gateway: QuoteGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteGateway,
        {
          provide: QuoteService,
          useValue: {},
        },
        {
          provide: AuthService,
          useValue: {},
        },
      ],
    }).compile();

    gateway = module.get<QuoteGateway>(QuoteGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
