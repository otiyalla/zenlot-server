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

  it('deduplicates concurrent subscriptions for the same room', async () => {
    let resolveJoin!: () => void;
    const client = {
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveJoin = resolve;
          }),
      ),
    };
    liveService.getLiveBar.mockResolvedValue(null);

    const first = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    const duplicate = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );

    expect(client.join).toHaveBeenCalledTimes(1);
    expect(liveService.subscribe).toHaveBeenCalledTimes(1);

    resolveJoin();
    await Promise.all([first, duplicate]);
    expect(client.candleRooms.size).toBe(1);
  });

  it('does not emit an initial bar after the client unsubscribes', async () => {
    let resolveBar!: (bar: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }) => void;
    const pendingBar = new Promise<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>((resolve) => {
      resolveBar = resolve;
    });
    const client = {
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn(),
    };
    liveService.getLiveBar.mockReturnValue(pendingBar);

    const subscription = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    await Promise.resolve();

    gateway.handleUnsubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    resolveBar({ time: 1, open: 1, high: 1, low: 1, close: 1 });
    await subscription;

    expect(client.emit).not.toHaveBeenCalledWith(
      'candle:update',
      expect.anything(),
    );
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
