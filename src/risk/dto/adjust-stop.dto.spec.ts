import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustStopDto } from './adjust-stop.dto';

const validateDto = (payload: Record<string, unknown>) =>
  validate(
    plainToInstance(AdjustStopDto, payload, {
      enableImplicitConversion: true,
    }),
  );

const errorFor = async (payload: Record<string, unknown>, field: string) => {
  const errors = await validateDto(payload);
  return errors.find((e) => e.property === field);
};

describe('AdjustStopDto', () => {
  it('accepts a positive stopPrice and a non-empty reason', async () => {
    expect(
      await validateDto({ stopPrice: 1.092, reason: 'price action shifted' }),
    ).toHaveLength(0);
  });

  it('rejects a missing reason', async () => {
    const err = await errorFor({ stopPrice: 1.092 }, 'reason');
    expect(err).toBeDefined();
  });

  it('rejects an empty-string reason', async () => {
    const err = await errorFor({ stopPrice: 1.092, reason: '' }, 'reason');
    expect(err?.constraints).toHaveProperty('minLength');
  });

  it('rejects a non-positive stopPrice', async () => {
    const err = await errorFor({ stopPrice: 0, reason: 'x' }, 'stopPrice');
    expect(err?.constraints).toHaveProperty('isPositive');
  });

  it('rejects a non-numeric stopPrice', async () => {
    const err = await errorFor({ stopPrice: 'abc', reason: 'x' }, 'stopPrice');
    expect(err).toBeDefined();
  });
});
