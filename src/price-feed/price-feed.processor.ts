import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import axios from 'axios';
import { Job } from 'bullmq';
import { config } from 'src/config/config.constant';
import { buildRedisOptions, reportRedisErrors } from 'src/config/redis.config';

@Processor('price-feed')
export class PriceFeedProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(PriceFeedProcessor.name);
  private publisher: Redis;

  constructor(private readonly configService: ConfigService) {
    super();
    this.publisher = new Redis({
      ...buildRedisOptions(this.configService),
      connectionName: 'zenlot:price-feed-publisher',
      keepAlive: 1000,
      lazyConnect: true,
      commandTimeout: 10000,
    });

    reportRedisErrors(
      this.publisher,
      this.logger,
      'PriceFeedProcessor.publisher',
    );
  }

  async process(job: Job<{ symbol: string }>): Promise<unknown> {
    const { name } = job;

    if (name === 'price-feed') {
      const symbol = job.data.symbol;
      try {
        const url = `https://financialmodelingprep.com/api/v3/fx/${symbol}?apikey=${config.fmp_api_key}`;
        const response = await axios.get<unknown>(url);

        // Publish the price to the Redis channel
        const { data } = response; // Adjust based on actual API response structure
        await this.publisher.publish('price-feed', JSON.stringify(data));
        return data;
      } catch (error) {
        this.logger.error(`Error fetching price for ${symbol}`, error);
        Sentry.captureException(error, {
          extra: { symbol, context: 'PriceFeedProcessor' },
        });
        throw error; // Re-throw to let Bull handle retries or failures
      }
    }
    return null;
  }

  onModuleDestroy() {
    this.publisher.disconnect();
    this.logger.log('Redis publisher disconnected');
  }
}
