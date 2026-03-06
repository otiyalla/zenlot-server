import { Logger, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors.config';
import { AuthService } from '../auth/auth.service';

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

  constructor(private readonly authService: AuthService) {}

  private getUserRoom(userId: string): string {
    return `user_${userId}`;
  }

  onModuleInit() {
    // Handle client connections
    this.server.on('connection', async (socket: Socket) => {
      const accessToken = this.extractAccessToken(socket);
      if (!accessToken) {
        this.logger.warn(
          `Price feed socket missing access token: ${socket.id}`,
        );
        socket.disconnect(true);
        return;
      }

      const user = await this.authService.verifyToken(accessToken);
      if (!user) {
        this.logger.warn(`Price feed socket auth failed: ${socket.id}`);
        socket.disconnect(true);
        return;
      }

      (socket as any).user = user;
      this.logger.log(`Price Feed Client connected: ${socket.id}`);
      socket.join(this.getUserRoom(user.id));
      socket.on('disconnect', () => {
        this.logger.log(`Price Feed Client disconnected: ${socket.id}`);
      });
    });
  }

  private extractAccessToken(socket: Socket): string | undefined {
    const authToken = (socket.handshake?.auth as any)?.accessToken;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const headerToken = socket.handshake?.headers?.['accessToken'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
      return headerToken.trim();
    }

    const authorization = socket.handshake?.headers?.authorization;
    if (typeof authorization === 'string') {
      const match = authorization.match(/^Bearer\\s+(.+)$/i);
      if (match?.[1]) {
        return match[1].trim();
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
