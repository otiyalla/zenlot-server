import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CreatePriceFeedDto } from './dto/create-price-feed.dto';
import { UpdatePriceFeedDto } from './dto/update-price-feed.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'src/config/config.constant';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from 'src/quote/quote.service';


@Injectable()
export class PriceFeedService {
  private subscriber = new Redis({
    host: config.redis_host,
    port: Number(config.redis_port),
    keepAlive: 1000,
    lazyConnect: true,
    commandTimeout: 10000, 
  });
  constructor(
    private readonly gateway: PriceFeedGateway,
    private readonly quoteService: QuoteService,
    @InjectQueue('price-feed') private readonly priceFeedQueue: Queue,
  ){}

  // Add a new price feed job to the queue
  async addPriceFeedJob(symbol: string) {
    const job = await this.priceFeedQueue.add('price-feed', symbol);
    console.log('PriceFeedService: Added job to queue:', job.id);
    return job;
  }

  async getFX(symbol: string) {
    return this.quoteService.quote(symbol);
  }

  async onModuleInit() {
    
    await this.subscriber.subscribe('price-feed');
    this.subscriber.on('message', (channel, message) => {
      console.log(`Received message from channel ${channel}:`, message);
      if (channel === 'price-feed') {
        const data = JSON.parse(message);
        console.log('Received price feed data:', data);
        // Emit the data to the WebSocket server
        this.gateway.server.emit('price-feed-update', data);
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
    console.log('PriceFeedService: Redis subscriber disconnected');
  }

}
