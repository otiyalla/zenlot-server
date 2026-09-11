import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { OandaCandleProvider } from './oanda-candle.provider';

jest.mock('axios');

describe('OandaCandleProvider', () => {
  it.each(['H4', 'D1'] as const)(
    'requests UTC-aligned %s candles',
    async (timeframe) => {
      const request = jest.fn().mockResolvedValue({ data: { candles: [] } });
      jest.mocked(axios.create).mockReturnValue(request as never);
      const configService = {
        get: jest.fn((key: string) =>
          key === 'OANDA_API_KEY' ? 'test-token' : undefined,
        ),
      } as unknown as ConfigService;
      const provider = new OandaCandleProvider(configService);

      await provider.fetchCandles('EURUSD', timeframe, 0, 1_000);

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            dailyAlignment: 0,
            alignmentTimezone: 'UTC',
          }),
        }),
      );
    },
  );
});
