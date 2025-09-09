import { WebSocketGateway, SubscribeMessage, MessageBody, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { PriceFeedService } from './price-feed.service';
import { CreatePriceFeedDto } from './dto/create-price-feed.dto';
import { UpdatePriceFeedDto } from './dto/update-price-feed.dto';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';

@WebSocketGateway({ 
  //cros: true, 
  cros: { 
    //origin: '*', 
    origin: ['http://localhost:8081', 'https://zenlot.com'], 
    //methods: ['GET', 'POST'],
    //allowedHeaders: ['Content-Type'],
    //credentials: true 
  },
    //transports: ['websocket', 'polling'],
  namespace: 'price-feed' 
})
export class PriceFeedGateway implements OnModuleInit {
  @WebSocketServer()
  server: Server;

  onModuleInit() {
    // Handle client connections
    this.server.on('connection', (socket: Socket) => {
      console.log(`Price Feed Client connected: ${socket.id}`);
      
      // Join user to their personal room
      socket.join(`user_${socket.id}`);
      
      socket.on('disconnect', () => {
        console.log(`Price Feed Client disconnected: ${socket.id}`);
      });
    });
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
