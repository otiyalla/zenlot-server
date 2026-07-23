import { ServiceUnavailableException } from '@nestjs/common';
import { RateResolverService } from './rate-resolver.service';
import { QuoteService } from '../quote/quote.service';

function make(fxRate: jest.Mock) {
  return new RateResolverService({ fxRate } as unknown as QuoteService);
}

describe('RateResolverService.resolveExchangeRate', () => {
  it('returns 1 and skips the rate service when quote === account', async () => {
    const fxRate = jest.fn();
    const rate = await make(fxRate).resolveExchangeRate('EURUSD', 'USD');
    expect(rate).toBe(1);
    expect(fxRate).not.toHaveBeenCalled();
  });

  it('fetches the quote→account rate for a cross pair', async () => {
    const fxRate = jest.fn().mockResolvedValue({ price: 1.27 });
    const rate = await make(fxRate).resolveExchangeRate('EURGBP', 'USD');
    expect(fxRate).toHaveBeenCalledWith({ base: 'GBP', quote: 'USD' });
    expect(rate).toBeCloseTo(1.27, 6);
  });

  it('falls back to the inverse pair and inverts the rate', async () => {
    const fxRate = jest
      .fn()
      .mockRejectedValueOnce(new Error('no GBPUSD'))
      .mockResolvedValueOnce({ price: 0.7874 });
    const rate = await make(fxRate).resolveExchangeRate('EURGBP', 'USD');
    expect(fxRate).toHaveBeenNthCalledWith(1, { base: 'GBP', quote: 'USD' });
    expect(fxRate).toHaveBeenNthCalledWith(2, { base: 'USD', quote: 'GBP' });
    expect(rate).toBeCloseTo(1 / 0.7874, 6);
  });

  it('throws ServiceUnavailable when both lookups fail', async () => {
    const fxRate = jest.fn().mockRejectedValue(new Error('down'));
    await expect(
      make(fxRate).resolveExchangeRate('EURGBP', 'USD'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
