import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  WebSocketServer,
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import * as Sentry from '@sentry/nestjs';
import { QuoteService } from './quote.service';
import { Namespace, Server, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors.config';
import { AuthService } from '../auth/auth.service';
import { QuoteRequestDto } from './dto/quote-request.dto';
import {
  isSocketSessionRevoked,
  SocketSessionRegistry,
} from '../auth/socket-session-registry.service';

interface AuthUser {
  id: string;
  authVersion: number;
}

interface AuthenticatedSocket extends Socket {
  user?: AuthUser;
  userRoom?: string;
}

interface SocketHandshakeAuth {
  accessToken?: unknown;
}

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: 'quote',
})
export class QuoteGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteGateway.name);

  @WebSocketServer()
  server: Server | Namespace;

  private connectedSockets: Set<string> = new Set();

  constructor(
    private readonly quoteService: QuoteService,
    private readonly authService: AuthService,
    private readonly socketSessions: SocketSessionRegistry,
  ) {}

  private getUserRoom(userId: string): string {
    return `user_${userId}`;
  }

  emitTradeClosed(userId: string, trade: unknown): void {
    this.server.to(this.getUserRoom(userId)).emit('trade-closed', trade);
  }

  emitCoachingReady(userId: string, payload: unknown): void {
    this.server.to(this.getUserRoom(userId)).emit('coaching_ready', payload);
  }

  onModuleInit() {
    // Handle client connections
    this.server.setMaxListeners(20);

    this.server.on('connection', async (socket: Socket) => {
      try {
        const accessToken = this.extractAccessToken(socket);
        if (!accessToken) {
          throw new Error('Missing access token');
        }

        const user = (await this.authService.verifyToken(
          accessToken,
        )) as AuthUser | null;
        if (!user?.id || !Number.isInteger(user.authVersion)) {
          throw new Error('Invalid socket identity');
        }
        if (
          !this.socketSessions.register(
            socket,
            user.id,
            user.authVersion,
            '/quote',
          )
        ) {
          return;
        }

        const authenticatedSocket = socket as AuthenticatedSocket;
        authenticatedSocket.user = user;

        // Join user to their personal room before treating the socket as ready.
        const userRoom = this.getUserRoom(user.id);
        authenticatedSocket.userRoom = userRoom;
        await socket.join(userRoom);
        if (socket.disconnected || isSocketSessionRevoked(socket)) {
          await socket.leave(userRoom);
          throw new Error('Socket disconnected during room join');
        }

        this.connectedSockets.add(socket.id);
        this.logger.log(
          `Client connected: ${socket.id} - Total connected: ${this.getConnectedClientsCount()}`,
        );
        socket.on('disconnect', () => {
          this.logger.log(
            `Client disconnected: ${socket.id} - Total connected: ${this.getConnectedClientsCount()}`,
          );
          this.clearSockets(socket);
        });

        socket.on('error', (error) => {
          this.logger.error('Socket error', error);
          Sentry.captureException(error, {
            extra: { socketId: socket.id, context: 'QuoteGateway.socketError' },
          });
          this.clearSockets(socket);
        });
      } catch (error) {
        this.logger.warn(`Socket auth/setup failed: ${socket.id}`);
        Sentry.captureException(error, {
          extra: { socketId: socket.id, context: 'QuoteGateway.connection' },
        });
        try {
          socket.disconnect(true);
        } catch (disconnectError) {
          this.logger.error(
            'Failed to disconnect rejected socket',
            disconnectError,
          );
        }
      }
    });
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
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private clearSockets(socket: Socket, shutdown?: boolean) {
    try {
      const authenticatedSocket = socket as AuthenticatedSocket;
      const userRoom =
        authenticatedSocket.userRoom ??
        (authenticatedSocket.user?.id
          ? this.getUserRoom(authenticatedSocket.user.id)
          : undefined);
      this.connectedSockets.delete(socket.id);
      if (userRoom) {
        void socket.leave(userRoom);
      }
      //socket.disconnect(true);
      if (shutdown) socket.removeAllListeners();
    } catch (error) {
      this.logger.error('Error clearing sockets', error);
      Sentry.captureException(error, {
        extra: { socketId: socket.id, context: 'QuoteGateway.clearSockets' },
      });
    }
  }

  onModuleDestroy() {
    this.logger.log('QuoteGateway: Cleaning up all connections...');
    this.disconnectAllClients();
  }

  private disconnectAllClients() {
    try {
      const socketsMap =
        this.server.sockets instanceof Map
          ? this.server.sockets
          : this.server.sockets.sockets;

      for (const [id, socket] of socketsMap) {
        this.logger.debug(`Disconnecting socket: ${id}`);
        this.clearSockets(socket);
      }

      // Namespace instances don't have `close()`, but expose parent server via `.server`.
      const closeTarget =
        typeof (this.server as Server).close === 'function'
          ? (this.server as Server)
          : (this.server as Namespace).server;

      void closeTarget?.close?.(() => {
        this.logger.log('QuoteGateway: Server closed successfully');
      });
    } catch (error) {
      this.logger.error('Error disconnecting all clients', error);
      Sentry.captureException(error, {
        extra: { context: 'QuoteGateway.disconnectAllClients' },
      });
    }
  }

  @SubscribeMessage('list-quotes')
  async handleEvent(@ConnectedSocket() client: Socket): Promise<void> {
    if (isSocketSessionRevoked(client)) return;
    const quotes = await this.quoteService.getAvailableForex();
    if (isSocketSessionRevoked(client)) return;
    client.emit('list-quote-update', quotes);
  }

  @SubscribeMessage('get-quote')
  async handleGetQuote(
    @MessageBody() symbol: QuoteRequestDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (isSocketSessionRevoked(client)) return;
    const quote = await this.quoteService.fxRate(symbol);
    if (isSocketSessionRevoked(client)) return;
    client.emit('quote-update', quote);
  }

  @SubscribeMessage('get-exchange-rate')
  async handleRate(
    @MessageBody() symbol: QuoteRequestDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (isSocketSessionRevoked(client)) return;
    const quote = await this.quoteService.cachedFxRate(symbol);
    if (isSocketSessionRevoked(client)) return;
    client.emit('exchange-rate-update', quote);
  }

  getConnectedClientsCount(): number {
    return this.connectedSockets.size;
  }
}
