import { CandleGateway } from './candle.gateway';
import { CandleLiveService } from './candle-live.service';
import { AuthService } from '../auth/auth.service';

describe('CandleGateway', () => {
  const liveService = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    getLiveBar: jest.fn(),
  };
  const gateway = new CandleGateway(
    liveService as unknown as CandleLiveService,
    {} as AuthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('disconnects and rejects subscriptions before authentication completes', async () => {
    const client = {
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
    };

    await gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M5' },
      client as never,
    );

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(liveService.subscribe).not.toHaveBeenCalled();
  });

  it('disconnects and rejects unsubscriptions before authentication completes', () => {
    const client = {
      disconnect: jest.fn(),
      leave: jest.fn(),
    };

    gateway.handleUnsubscribe(
      { symbol: 'EURUSD', timeframe: 'M5' },
      client as never,
    );

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.leave).not.toHaveBeenCalled();
    expect(liveService.unsubscribe).not.toHaveBeenCalled();
  });
});
