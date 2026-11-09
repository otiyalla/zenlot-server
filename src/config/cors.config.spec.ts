import { getCorsMethods } from './cors.config';

describe('cors config', () => {
  it('includes PATCH and OPTIONS methods', () => {
    const methods = getCorsMethods();

    expect(methods).toContain('PATCH');
    expect(methods).toContain('OPTIONS');
  });
});
