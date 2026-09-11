import { plainToInstance } from 'class-transformer';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { SignInDto } from './auth/dto/auth.dto';
import { CreateFeedbackDto } from './feedback/dto/create-feedback.dto';
import { CreateJournalDto } from './journal/dto/create-journal.dto';
import { CreateTradeDto } from './trade/dto/create-trade.dto';
import { CreateUserDto } from './user/dto/create-user.dto';

const validTradePayload = {
  userId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  symbol: 'EURUSD',
  entry: 1.1,
  lot: 0.1,
  pips: 10,
  execution: 'buy',
  accountCurrency: 'USD',
  exchangeRate: 1,
  stopLoss: { value: 1.1, pips: 10 },
  takeProfit: { value: 1.2, pips: 10 },
  status: 'open',
};

describe('Request validation boundaries', () => {
  it('rejects malformed authentication credentials', async () => {
    const dto = plainToInstance(SignInDto, {
      email: 'not-an-email',
      password: 'short',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('validates nested signup rule pips', async () => {
    const dto = plainToInstance(CreateUserDto, {
      fname: 'Jane',
      lname: 'Trader',
      email: 'jane@example.com',
      language: 'en',
      accountCurrency: 'USD',
      password: 'Password1!',
      rules: {
        forex: {
          take_profit: [{ pips: -10 }],
          stop_loss: [],
        },
      },
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects unsupported trade enums and non-positive values', async () => {
    const dto = plainToInstance(CreateTradeDto, {
      ...validTradePayload,
      entry: -1,
      execution: 'hold',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('validates trade status without restricting journal text', async () => {
    const dto = plainToInstance(CreateTradeDto, {
      ...validTradePayload,
      plainText: 'Entered after breakout',
    });

    expect(await validate(dto)).toHaveLength(0);

    dto.status = 'archived';
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts the default isAutoClosed flag (server forces it false on create)', async () => {
    const validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    // The client always submits isAutoClosed with its default `false`, so the
    // DTO whitelists it (the request is not rejected). The server controls the
    // real value: TradeService.create forces it to false, so a client cannot
    // persist isAutoClosed=true (covered in trade.service.spec.ts).
    const result = (await validationPipe.transform(
      { ...validTradePayload, isAutoClosed: false },
      { type: 'body', metatype: CreateTradeDto },
    )) as { isAutoClosed?: boolean };
    expect(result.isAutoClosed).toBe(false);
  });

  it('allows journal content columns to be omitted as in the Prisma model', async () => {
    const dto = plainToInstance(CreateJournalDto, {
      userId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      symbol: '',
      tags: ['review'],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unsupported feedback types', async () => {
    const dto = plainToInstance(CreateFeedbackDto, {
      email: 'jane@example.com',
      subject: 'A valid subject',
      message: 'A valid feedback message',
      type: 'delete_account',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
