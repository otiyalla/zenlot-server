import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from 'src/quote/quote.service';

@Injectable()
export class PriceFeedService {
  private readonly logger = new Logger(PriceFeedService.name);
  private subscriber: Redis;
  constructor(
    private readonly gateway: PriceFeedGateway,
    private readonly quoteService: QuoteService,
    private readonly config: ConfigService,
    @InjectQueue('price-feed') private readonly priceFeedQueue: Queue,
  ) {
    const host = this.config.get<string>('REDIS_HOST');
    const port = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const username = this.config.get<string>('REDIS_USERNAME');
    const password = this.config.get<string>('REDIS_PASSWORD');
    const tlsEnabled = ['1', 'true', 'yes'].includes(
      (this.config.get<string>('REDIS_TLS') ?? '').toLowerCase(),
    );
    const rejectUnauthorized =
      (
        this.config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') ?? 'true'
      ).toLowerCase() !== 'false';

    this.subscriber = new Redis({
      host,
      port,
      ...{ username, password },
      ...(tlsEnabled ? { tls: { servername: host, rejectUnauthorized } } : {}),
      keepAlive: 1000,
      lazyConnect: true,
      commandTimeout: 10000,
    });
  }

  // Add a new price feed job to the queue
  async addPriceFeedJob(symbol: string) {
    const job = await this.priceFeedQueue.add('price-feed', symbol);
    this.logger.log(`Added job to queue: ${job.id} for symbol ${symbol}`);
    return job;
  }

  async getFX(symbol: { base: string; quote: string }) {
    return this.quoteService.fxRate(symbol);
  }

  async search(query: string) {
    return this.quoteService.search(query);
  }

  async onModuleInit() {
    await this.subscriber.subscribe('price-feed');
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'price-feed') {
        try {
          const data = JSON.parse(message);
          this.gateway.server.emit('price-feed-update', data);
        } catch (error) {
          this.logger.error('Error parsing price feed message', error);
          Sentry.captureException(error, {
            extra: { channel, message, context: 'PriceFeedService.message' },
          });
        }
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
    this.logger.log('Redis subscriber disconnected');
  }
}
