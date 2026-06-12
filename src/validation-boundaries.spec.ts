import { plainToInstance } from 'class-transformer';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { SignInDto } from './auth/dto/auth.dto';
import { CreateFeedbackDto } from './feedback/dto/create-feedback.dto';
import { CreateJournalDto } from './journal/dto/create-journal.dto';
import { CreateTradeDto } from './trade/dto/create-trade.dto';
import { TradeOwnerDto } from './trade/dto/trade-owner.dto';
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

  it('allows the authenticated trade owner query to be omitted', async () => {
    const validationPipe = new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    await expect(
      validationPipe.transform({}, { type: 'query', metatype: TradeOwnerDto }),
    ).resolves.toBeInstanceOf(TradeOwnerDto);

    const dto = plainToInstance(TradeOwnerDto, {});
    expect(await validate(dto)).toHaveLength(0);
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

  it('rejects client-controlled auto-close metadata on trade creation', async () => {
    const validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    await validationPipe
      .transform(
        {
          ...validTradePayload,
          isAutoClosed: true,
        },
        { type: 'body', metatype: CreateTradeDto },
      )
      .then(
        () => {
          throw new Error('Expected trade validation to reject isAutoClosed');
        },
        (error: unknown) => {
          expect(error).toBeInstanceOf(BadRequestException);

          const response = (error as BadRequestException).getResponse();
          if (typeof response !== 'object' || response === null) {
            throw new Error('Expected validation error response object');
          }

          const message = (response as { message?: unknown }).message;
          expect(message).toContain('property isAutoClosed should not exist');
        },
      );
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
