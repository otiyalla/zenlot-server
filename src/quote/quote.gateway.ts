import { WebSocketServer, WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { QuoteService } from './quote.service';
import { Server, Socket } from 'socket.io';
import { ListQuotesDto } from './dto/quote-list.dto';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:8081', 'https://zenlot.com'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: 'quote',
})
export class QuoteGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private connectedSockets: Set<string> = new Set();
  
  constructor(private readonly quoteService: QuoteService) {}

 

  onModuleInit() {
    // Handle client connections
    this.server.setMaxListeners(20);

    this.server.on('connection', (socket: Socket) => {
      console.log(`Client connected: ${socket.id} - Total connected: ${this.getConnectedClientsCount()}`);
      this.connectedSockets.add(socket.id);
      
      // Join user to their personal room
      socket.join(`user_${socket.id}`);

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} - Total connected: ${this.getConnectedClientsCount()}`);
        this.clearSockets(socket);
      }); 

      socket.on('error', (error) => {
        console.error('Socket error:', error);
        this.clearSockets(socket);
      });
    });
  }

  private clearSockets(socket: Socket) {
    try {
      this.connectedSockets.delete(socket.id);
      socket.leave(`user_${socket.id}`);
      socket.removeAllListeners();
      socket.disconnect(true);
    } catch (error) {
      console.error('Error clearing sockets:', error);
    }
  }

  onModuleDestroy() {
    console.log('QuoteGateway: Cleaning up all connections...');
    this.disconnectAllClients();
  }

  private disconnectAllClients() {
    try {
      this.server.removeAllListeners(); // Remove all server listeners
      this.server.sockets.sockets.forEach((socket) => {
        this.clearSockets(socket);
      });
      this.connectedSockets.clear();
      this.server.close(() => {
        console.log('QuoteGateway: Server closed successfully');
      });
    } catch (error) {
      console.error('Error disconnecting all clients:', error);
    }
  }

  @SubscribeMessage('list-quotes')
  async handleEvent(@ConnectedSocket() client: Socket): Promise<void> {
    const quotes = await this.quoteService.getAvailableForex();
    client.emit('list-quote-update', quotes);
  }

  @SubscribeMessage('get-quote')
  async handleGetQuote(@MessageBody() symbol: string, @ConnectedSocket() client: Socket): Promise<void> {
    const quote = await this.quoteService.quote(symbol);
    client.emit('quote-update', quote);
  }

  @SubscribeMessage('get-exchange-rate')
  async handleRate(@MessageBody() symbol: string, @ConnectedSocket() client: Socket): Promise<void> {
    const quote = await this.quoteService.quote(symbol);
    client.emit('exchange-rate-update', quote);
  }

  // Method to send updates to specific user
  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  // Method to send updates to all users (if needed)
  sendToAll(event: string, data: any) {
    this.server.emit(event, data);
  }

  getConnectedClientsCount(): number {
    return this.connectedSockets.size;
  }
}
