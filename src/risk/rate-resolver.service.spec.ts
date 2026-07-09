import { ServiceUnavailableException } from '@nestjs/common';
import { RateResolverService } from './rate-resolver.service';
import { QuoteService } from '../quote/quote.service';

// The resolver resolves the quote→account conversion rate through the cached
// path (cachedFxRate), so the risk/governance recalcs share one upstream call.
function make(cachedFxRate: jest.Mock) {
  return new RateResolverService({ cachedFxRate } as unknown as QuoteService);
}

describe('RateResolverService.resolveExchangeRate', () => {
  it('returns 1 and skips the rate service when quote === account', async () => {
    const cachedFxRate = jest.fn();
    const rate = await make(cachedFxRate).resolveExchangeRate('EURUSD', 'USD');
    expect(rate).toBe(1);
    expect(cachedFxRate).not.toHaveBeenCalled();
  });

  it('fetches the quote→account rate for a cross pair', async () => {
    const cachedFxRate = jest.fn().mockResolvedValue({ price: 1.27 });
    const rate = await make(cachedFxRate).resolveExchangeRate('EURGBP', 'USD');
    expect(cachedFxRate).toHaveBeenCalledWith({ base: 'GBP', quote: 'USD' });
    expect(rate).toBeCloseTo(1.27, 6);
  });

  it('falls back to the inverse pair and inverts the rate', async () => {
    const cachedFxRate = jest
      .fn()
      .mockRejectedValueOnce(new Error('no GBPUSD'))
      .mockResolvedValueOnce({ price: 0.7874 });
    const rate = await make(cachedFxRate).resolveExchangeRate('EURGBP', 'USD');
    expect(cachedFxRate).toHaveBeenNthCalledWith(1, { base: 'GBP', quote: 'USD' });
    expect(cachedFxRate).toHaveBeenNthCalledWith(2, { base: 'USD', quote: 'GBP' });
    expect(rate).toBeCloseTo(1 / 0.7874, 6);
  });

  it('throws ServiceUnavailable when both lookups fail', async () => {
    const cachedFxRate = jest.fn().mockRejectedValue(new Error('down'));
    await expect(
      make(cachedFxRate).resolveExchangeRate('EURGBP', 'USD'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
