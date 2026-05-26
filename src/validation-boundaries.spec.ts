import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignInDto } from './auth/dto/auth.dto';
import { CreateFeedbackDto } from './feedback/dto/create-feedback.dto';
import { CreateJournalDto } from './journal/dto/create-journal.dto';
import { CreateTradeDto } from './trade/dto/create-trade.dto';
import { CreateUserDto } from './user/dto/create-user.dto';

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
      userId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      symbol: 'EURUSD',
      entry: -1,
      lot: 0.1,
      pips: 10,
      execution: 'hold',
      accountCurrency: 'USD',
      exchangeRate: 1,
      stopLoss: { value: 1.1, pips: 10 },
      takeProfit: { value: 1.2, pips: 10 },
      status: 'open',
    });

    expect(await validate(dto)).not.toHaveLength(0);
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
