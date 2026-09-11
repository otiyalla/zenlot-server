import {
  CandleLiveService,
  CANDLE_REFRESH_MS,
  candleRoomKey,
} from './candle-live.service';
import { CandleService } from './candle.service';

describe('CandleLiveService', () => {
  let service: CandleLiveService;
  let candleService: { getLiveBar: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    candleService = { getLiveBar: jest.fn().mockResolvedValue(null) };
    service = new CandleLiveService(candleService as unknown as CandleService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('builds a stable room key', () => {
    expect(candleRoomKey('EURUSD', 'H1')).toBe('EURUSD:H1');
  });

  it('opens one timer per room regardless of subscriber count', () => {
    service.subscribe('EURUSD', 'H1');
    service.subscribe('EURUSD', 'H1');
    expect(service.activeRoomCount()).toBe(1);
  });

  it('closes the room only when the last subscriber leaves', () => {
    service.subscribe('EURUSD', 'H1');
    service.subscribe('EURUSD', 'H1');
    service.unsubscribe('EURUSD', 'H1');
    expect(service.activeRoomCount()).toBe(1);
    service.unsubscribe('EURUSD', 'H1');
    expect(service.activeRoomCount()).toBe(0);
  });

  it('fires the tick handler on the refresh cadence', () => {
    const onTick = jest.fn();
    service.registerTickHandler(onTick);
    service.subscribe('EURUSD', 'H1');

    expect(onTick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(CANDLE_REFRESH_MS);
    expect(onTick).toHaveBeenCalledWith('EURUSD', 'H1');
  });

  it('stops ticking after the room closes', () => {
    const onTick = jest.fn();
    service.registerTickHandler(onTick);
    service.subscribe('EURUSD', 'H1');
    service.unsubscribe('EURUSD', 'H1');

    jest.advanceTimersByTime(CANDLE_REFRESH_MS * 2);
    expect(onTick).not.toHaveBeenCalled();
  });
});
