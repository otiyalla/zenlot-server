import { Logger, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors.config';
import { AuthService } from '../auth/auth.service';
import {
  isSocketSessionRevoked,
  SocketSessionRegistry,
} from '../auth/socket-session-registry.service';

interface AuthUser {
  id: string;
  authVersion: number;
}

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: 'price-feed',
})
export class PriceFeedGateway implements OnModuleInit {
  private readonly logger = new Logger(PriceFeedGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly socketSessions: SocketSessionRegistry,
  ) {}

  private getUserRoom(userId: string): string {
    return `user_${userId}`;
  }

  onModuleInit() {
    // Handle client connections
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
            '/price-feed',
          )
        ) {
          return;
        }

        (socket as Socket & { user: typeof user }).user = user;
        const userRoom = this.getUserRoom(user.id);
        await socket.join(userRoom);
        if (socket.disconnected || isSocketSessionRevoked(socket)) {
          await socket.leave(userRoom);
          throw new Error('Socket disconnected during room join');
        }
        this.logger.log(`Price Feed Client connected: ${socket.id}`);
        socket.on('disconnect', () => {
          this.logger.log(`Price Feed Client disconnected: ${socket.id}`);
        });
      } catch (_error) {
        this.logger.warn(`Price feed socket auth/setup failed: ${socket.id}`);
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
    const authToken = (socket.handshake?.auth as Record<string, unknown>)?.[
      'accessToken'
    ];
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    // Node normalizes incoming header names to lowercase.
    const headerToken = socket.handshake?.headers?.['accesstoken'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
      return headerToken.trim();
    }

    const authorization = socket.handshake?.headers?.authorization;
    if (typeof authorization === 'string') {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
      if (match?.[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /*
  constructor(private readonly priceFeedService: PriceFeedService) {}

  @SubscribeMessage('priceFeed')
  getPriceFeedJob(@MessageBody() createPriceFeedDto: CreatePriceFeedDto) {
    return this.priceFeedService.addPriceFeedJob(createPriceFeedDto);
  }

  @SubscribeMessage('priceQuote')
  async getQuote(@MessageBody() quote: string) {
    console.log("the q: ", quote)
    return this.priceFeedService.getQuote(quote);
  }
    */
}
