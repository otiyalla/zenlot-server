import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { CandleService, CandleDto } from './candle.service';
import { Timeframe } from './interface/candle.interface';

/** Socket.io room name for a pair/timeframe subscription. */
export function candleRoomKey(pair: string, timeframe: Timeframe): string {
  return `${pair}:${timeframe}`;
}

/** Server-side refresh cadence: poll upstream once every 5 minutes per room. */
export const CANDLE_REFRESH_MS = 5 * 60 * 1000;

interface RoomState {
  /** Number of connected subscribers for this room. */
  count: number;
  pair: string;
  timeframe: Timeframe;
  timer: NodeJS.Timeout;
}

type TickHandler = (pair: string, timeframe: Timeframe) => void;

/**
 * Owns the per-room refresh schedulers for the live candle feed. One timer per
 * active (pair, timeframe) regardless of how many clients are watching — the
 * tick refreshes the cache once and the gateway fans the result out to every
 * subscriber, so connected clients never multiply upstream API calls. The timer
 * starts on the first subscriber and stops when the last one leaves.
 */
@Injectable()
export class CandleLiveService implements OnModuleDestroy {
  private readonly logger = new Logger(CandleLiveService.name);
  private readonly rooms = new Map<string, RoomState>();
  private onTick?: TickHandler;

  constructor(private readonly candleService: CandleService) {}

  /** Wire the broadcast callback (provided by the gateway). */
  registerTickHandler(handler: TickHandler): void {
    this.onTick = handler;
  }

  /** Register a subscriber; starts the room's refresh timer if it's the first. */
  subscribe(pair: string, timeframe: Timeframe): void {
    const key = candleRoomKey(pair, timeframe);
    const existing = this.rooms.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    const timer = setInterval(
      () => this.onTick?.(pair, timeframe),
      CANDLE_REFRESH_MS,
    );
    // Don't keep the event loop (or tests) alive on this timer.
    timer.unref?.();
    this.rooms.set(key, { count: 1, pair, timeframe, timer });
    this.logger.log(`Live room opened: ${key}`);
  }

  /** Deregister a subscriber; stops the timer when the room empties. */
  unsubscribe(pair: string, timeframe: Timeframe): void {
    const key = candleRoomKey(pair, timeframe);
    const existing = this.rooms.get(key);
    if (!existing) return;
    existing.count -= 1;
    if (existing.count <= 0) {
      clearInterval(existing.timer);
      this.rooms.delete(key);
      this.logger.log(`Live room closed: ${key}`);
    }
  }

  /** Latest bar for an immediate push or a scheduled tick. */
  getLiveBar(pair: string, timeframe: Timeframe): Promise<CandleDto | null> {
    return this.candleService.getLiveBar(pair, timeframe);
  }

  activeRoomCount(): number {
    return this.rooms.size;
  }

  onModuleDestroy(): void {
    for (const { timer } of this.rooms.values()) {
      clearInterval(timer);
    }
    this.rooms.clear();
  }
}
