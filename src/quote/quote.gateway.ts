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

interface AuthUser {
  id: string;
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
  ) {}

  private getUserRoom(userId: string): string {
    return `user_${userId}`;
  }

  emitTradeClosed(userId: string, trade: unknown): void {
    this.server.to(this.getUserRoom(userId)).emit('trade-closed', trade);
  }

  onModuleInit() {
    // Handle client connections
    this.server.setMaxListeners(20);

    this.server.on('connection', async (socket: Socket) => {
      const accessToken = this.extractAccessToken(socket);
      if (!accessToken) {
        this.logger.warn(`Socket missing access token: ${socket.id}`);
        socket.disconnect(true);
        return;
      }

      const user = (await this.authService.verifyToken(
        accessToken,
      )) as AuthUser | null;
      if (!user?.id) {
        this.logger.warn(`Socket auth failed: ${socket.id}`);
        socket.disconnect(true);
        return;
      }

      const authenticatedSocket = socket as AuthenticatedSocket;
      authenticatedSocket.user = user;
      this.logger.log(
        `Client connected: ${socket.id} - Total connected: ${this.getConnectedClientsCount()}`,
      );
      this.connectedSockets.add(socket.id);

      // Join user to their personal room
      const userRoom = this.getUserRoom(user.id);
      authenticatedSocket.userRoom = userRoom;
      void socket.join(userRoom);

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
    });
  }

  private extractAccessToken(socket: Socket): string | undefined {
    const authToken = (socket.handshake.auth as SocketHandshakeAuth)
      .accessToken;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const headerToken = socket.handshake?.headers?.['accessToken'];
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
    const quotes = await this.quoteService.getAvailableForex();
    client.emit('list-quote-update', quotes);
  }

  @SubscribeMessage('get-quote')
  async handleGetQuote(
    @MessageBody() symbol: QuoteRequestDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const quote = await this.quoteService.fxRate(symbol);
    client.emit('quote-update', quote);
  }

  @SubscribeMessage('get-exchange-rate')
  async handleRate(
    @MessageBody() symbol: QuoteRequestDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const quote = await this.quoteService.fxRate(symbol);
    client.emit('exchange-rate-update', quote);
  }

  getConnectedClientsCount(): number {
    return this.connectedSockets.size;
  }
}
