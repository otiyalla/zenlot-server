import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRiskProfileDto } from './update-risk-profile.dto';

// Mirror the global ValidationPipe's implicit conversion so the test exercises
// the DTO the way the controller receives it.
const validateDto = (payload: Record<string, unknown>) =>
  validate(
    plainToInstance(UpdateRiskProfileDto, payload, {
      enableImplicitConversion: true,
    }),
  );

const constraintsFor = async (
  payload: Record<string, unknown>,
  field: string,
) => {
  const errors = await validateDto(payload);
  return errors.find((error) => error.property === field)?.constraints ?? {};
};

describe('UpdateRiskProfileDto — accountBalance bounds', () => {
  it('accepts a normal balance', async () => {
    expect(await validateDto({ accountBalance: 2005.45 })).toHaveLength(0);
  });

  it('accepts the boundary values 0 and 1e12', async () => {
    expect(await validateDto({ accountBalance: 0 })).toHaveLength(0);
    expect(await validateDto({ accountBalance: 1_000_000_000_000 })).toHaveLength(
      0,
    );
  });

  it('rejects a balance above the 1e12 maximum (matches the DB CHECK)', async () => {
    expect(
      await constraintsFor({ accountBalance: 1_000_000_000_001 }, 'accountBalance'),
    ).toHaveProperty('max');
  });

  it('rejects a negative balance (manual-entry floor)', async () => {
    expect(
      await constraintsFor({ accountBalance: -0.01 }, 'accountBalance'),
    ).toHaveProperty('min');
  });

  it('treats the patch as optional (an empty body is valid)', async () => {
    expect(await validateDto({})).toHaveLength(0);
  });
});
