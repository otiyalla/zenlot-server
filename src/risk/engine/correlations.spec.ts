import { CORRELATION_DISCLAIMER, getCorrelatedPairs } from './correlations';

describe('getCorrelatedPairs', () => {
  it('returns same-group pairs and excludes the pair itself', () => {
    const correlated = getCorrelatedPairs('EURUSD');
    expect(correlated).toContain('GBPUSD'); // USD_NEGATIVE
    expect(correlated).toContain('EURGBP'); // EUR_BLOC
    expect(correlated).not.toContain('EURUSD');
  });

  it('is case-insensitive', () => {
    expect(getCorrelatedPairs('eurusd')).toContain('GBPUSD');
  });

  it('returns an empty list for an unknown pair', () => {
    expect(getCorrelatedPairs('XYZABC')).toEqual([]);
  });

  it('does not duplicate a pair that appears in multiple groups', () => {
    const correlated = getCorrelatedPairs('USDJPY');
    expect(correlated.filter((p) => p === 'EURJPY')).toHaveLength(1);
  });

  it('exposes the UI disclaimer string', () => {
    expect(CORRELATION_DISCLAIMER('en')).toContain('high-impact events');
    expect(CORRELATION_DISCLAIMER('fr')).toContain(
      'événements de grande ampleur',
    );
    expect(CORRELATION_DISCLAIMER('es')).toContain('alto impacto');
  });
});
