import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CreatePriceFeedDto } from './dto/create-price-feed.dto';
import { UpdatePriceFeedDto } from './dto/update-price-feed.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'src/config/config.constant';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from 'src/quote/quote.service';


@Injectable()
export class PriceFeedService {
  private subscriber: Redis;
  constructor(
    private readonly gateway: PriceFeedGateway,
    private readonly quoteService: QuoteService,
    private readonly config: ConfigService,
    @InjectQueue('price-feed') private readonly priceFeedQueue: Queue,
  ){
    const host = this.config.get<string>('REDIS_HOST');
    const port = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const username = this.config.get<string>('REDIS_USERNAME');
    const password = this.config.get<string>('REDIS_PASSWORD');
    const tlsEnabled = ['1', 'true', 'yes'].includes(
      (this.config.get<string>('REDIS_TLS') ?? '').toLowerCase(),
    );
    const rejectUnauthorized =
      (this.config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') ?? 'true').toLowerCase() !== 'false';

    this.subscriber = new Redis({
      host,
      port,
      username,
      password,
      ...(tlsEnabled ? { tls: { servername: host, rejectUnauthorized } } : {}),
      keepAlive: 1000,
      lazyConnect: true,
      commandTimeout: 10000,
    });
  }

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
