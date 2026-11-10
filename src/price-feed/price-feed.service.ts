import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PriceFeedGateway } from './price-feed.gateway';
import { QuoteService } from 'src/quote/quote.service';
import { CreatePriceFeedDto } from './dto/create-price-feed.dto';
import { buildRedisOptions, reportRedisErrors } from 'src/config/redis.config';

@Injectable()
export class PriceFeedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceFeedService.name);
  private subscriber: Redis;
  constructor(
    private readonly gateway: PriceFeedGateway,
    private readonly quoteService: QuoteService,
    private readonly config: ConfigService,
    @InjectQueue('price-feed') private readonly priceFeedQueue: Queue,
  ) {
    this.subscriber = new Redis({
      ...buildRedisOptions(this.config),
      connectionName: 'zenlot:price-feed-subscriber',
      keepAlive: 1000,
      lazyConnect: true,
      commandTimeout: 10000,
    });

    reportRedisErrors(
      this.subscriber,
      this.logger,
      'PriceFeedService.subscriber',
    );
  }

  // Add a new price feed job to the queue
  async addPriceFeedJob(createPriceFeedDto: CreatePriceFeedDto) {
    const job = await this.priceFeedQueue.add('price-feed', createPriceFeedDto);
    this.logger.log(
      `Added job to queue: ${job.id} for symbol ${createPriceFeedDto.symbol}`,
    );
    return job;
  }

  async getFX(symbol: { base: string; quote: string }) {
    return this.quoteService.fxRate(symbol);
  }

  async search(query: string) {
    return this.quoteService.search(query);
  }

  private async subscribeToPriceFeed() {
    try {
      await this.subscriber.subscribe('price-feed');
      this.logger.log('Subscribed to Redis price feed');
    } catch (error) {
      this.logger.error('Failed to subscribe to Redis price feed', error);
      Sentry.captureException(error, {
        extra: { context: 'PriceFeedService.subscribeToPriceFeed' },
      });
    }
  }

  onModuleInit() {
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'price-feed') {
        try {
          const data: unknown = JSON.parse(message);
          this.gateway.server.emit('price-feed-update', data);
        } catch (error) {
          this.logger.error('Error parsing price feed message', error);
          Sentry.captureException(error, {
            extra: { channel, message, context: 'PriceFeedService.message' },
          });
        }
      }
    });

    this.subscriber.on('ready', () => {
      void this.subscribeToPriceFeed();
    });

    void this.subscriber.connect().catch((error: unknown) => {
      this.logger.error('Failed to connect Redis subscriber', error);
      Sentry.captureException(error, {
        extra: { context: 'PriceFeedService.onModuleInit' },
      });
    });
  }

  onModuleDestroy() {
    this.subscriber.disconnect();
    this.logger.log('Redis subscriber disconnected');
  }
}
