import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  WebSocketServer,
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import * as Sentry from '@sentry/nestjs';
import { Namespace, Server, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors.config';
import { AuthService } from '../auth/auth.service';
import { CandleLiveService, candleRoomKey } from './candle-live.service';
import { isTimeframe, Timeframe } from './interface/candle.interface';
import { normalizePair } from './util/symbol.util';

interface AuthUser {
  id: string;
}

interface CandleRoom {
  pair: string;
  timeframe: Timeframe;
}

interface AuthenticatedSocket extends Socket {
  user?: AuthUser;
  candleRooms?: Map<string, CandleRoom>;
}

interface SocketHandshakeAuth {
  accessToken?: unknown;
}

interface SubscribePayload {
  symbol?: unknown;
  timeframe?: unknown;
}

/**
 * Live candle feed. Clients `subscribe` to a pair/timeframe and receive a
 * `candle:update` immediately and then every 5 minutes (see CandleLiveService).
 * Auth mirrors QuoteGateway: the handshake access token is verified on connect
 * and unauthenticated sockets are dropped.
 */
@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: 'candle',
})
export class CandleGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandleGateway.name);

  @WebSocketServer()
  server: Server | Namespace;

  constructor(
    private readonly liveService: CandleLiveService,
    private readonly authService: AuthService,
  ) {}

  onModuleInit() {
    this.server.setMaxListeners(50);
    // Each scheduled tick refreshes the cache and fans the latest bar out to the
    // whole room — one upstream refresh, many subscribers.
    this.liveService.registerTickHandler((pair, timeframe) => {
      void this.broadcast(pair, timeframe);
    });

    this.server.on('connection', async (socket: Socket) => {
      const accessToken = this.extractAccessToken(socket);
      if (!accessToken) {
        socket.disconnect(true);
        return;
      }
      const user = (await this.authService.verifyToken(
        accessToken,
      )) as AuthUser | null;
      if (!user?.id) {
        socket.disconnect(true);
        return;
      }

      const authed = socket as AuthenticatedSocket;
      authed.user = user;
      authed.candleRooms = new Map();

      socket.on('disconnect', () => this.cleanup(authed));
      socket.on('error', (error) => {
        Sentry.captureException(error, {
          extra: { socketId: socket.id, context: 'CandleGateway.socketError' },
        });
        this.cleanup(authed);
      });
    });
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() body: SubscribePayload,
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    if (!client.user || !client.candleRooms) {
      client.disconnect(true);
      return;
    }

    const parsed = this.parse(body);
    if (!parsed) {
      client.emit('candle:error', { message: 'Invalid subscription' });
      return;
    }
    const { pair, timeframe } = parsed;
    const key = candleRoomKey(pair, timeframe);

    // Idempotent: ignore a repeat subscribe for a room this socket already has.
    if (client.candleRooms?.has(key)) return;

    await client.join(key);
    client.candleRooms?.set(key, { pair, timeframe });
    this.liveService.subscribe(pair, timeframe);

    // Push the current bar immediately so the client doesn't wait a full cycle.
    try {
      const bar = await this.liveService.getLiveBar(pair, timeframe);
      if (bar) {
        client.emit('candle:update', { symbol: pair, timeframe, bar });
      }
    } catch (error) {
      this.logger.warn(
        `Initial live bar failed for ${key}: ${(error as Error).message}`,
      );
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() body: SubscribePayload,
    @ConnectedSocket() client: AuthenticatedSocket,
  ): void {
    if (!client.user || !client.candleRooms) {
      client.disconnect(true);
      return;
    }

    const parsed = this.parse(body);
    if (!parsed) return;
    const { pair, timeframe } = parsed;
    const key = candleRoomKey(pair, timeframe);
    if (!client.candleRooms?.has(key)) return;
    void client.leave(key);
    client.candleRooms.delete(key);
    this.liveService.unsubscribe(pair, timeframe);
  }

  private async broadcast(pair: string, timeframe: Timeframe): Promise<void> {
    try {
      const bar = await this.liveService.getLiveBar(pair, timeframe);
      if (bar) {
        this.server
          .to(candleRoomKey(pair, timeframe))
          .emit('candle:update', { symbol: pair, timeframe, bar });
      }
    } catch (error) {
      this.logger.warn(
        `Live broadcast failed for ${pair} ${timeframe}: ${(error as Error).message}`,
      );
      Sentry.captureException(error, {
        extra: { context: 'CandleGateway.broadcast', pair, timeframe },
      });
    }
  }

  /** Normalize + validate a subscribe/unsubscribe payload. */
  private parse(
    body: SubscribePayload,
  ): { pair: string; timeframe: Timeframe } | null {
    if (
      typeof body?.symbol !== 'string' ||
      typeof body?.timeframe !== 'string'
    ) {
      return null;
    }
    if (!isTimeframe(body.timeframe)) return null;
    try {
      return { pair: normalizePair(body.symbol), timeframe: body.timeframe };
    } catch {
      return null;
    }
  }

  /** Release every room this socket held when it disconnects. */
  private cleanup(socket: AuthenticatedSocket): void {
    if (!socket.candleRooms) return;
    for (const { pair, timeframe } of socket.candleRooms.values()) {
      this.liveService.unsubscribe(pair, timeframe);
    }
    socket.candleRooms.clear();
  }

  private extractAccessToken(socket: Socket): string | undefined {
    const authToken = (
      socket.handshake?.auth as SocketHandshakeAuth | undefined
    )?.accessToken;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }
    const headerToken = socket.handshake?.headers?.['accesstoken'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
      return headerToken.trim();
    }
    const authorization = socket.handshake?.headers?.authorization;
    if (typeof authorization === 'string') {
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (match?.[1]) return match[1].trim();
    }
    return undefined;
  }

  onModuleDestroy(): void {
    try {
      const socketsMap =
        this.server.sockets instanceof Map
          ? this.server.sockets
          : this.server.sockets.sockets;
      for (const [, socket] of socketsMap) {
        this.cleanup(socket as AuthenticatedSocket);
      }
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'CandleGateway.onModuleDestroy' },
      });
    }
  }
}
