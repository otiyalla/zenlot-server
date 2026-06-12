import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import axios from 'axios';
import { Job } from 'bullmq';
import { config } from 'src/config/config.constant';

@Processor('price-feed')
export class PriceFeedProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceFeedProcessor.name);
  private publisher: Redis;

  constructor(private readonly configService: ConfigService) {
    super();
    const host = this.configService.get<string>('REDIS_HOST');
    const port = Number(this.configService.get<string>('REDIS_PORT') ?? 6379);
    const username = this.configService.get('REDIS_USERNAME');
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const tlsEnabled = ['1', 'true', 'yes'].includes(
      (this.configService.get<string>('REDIS_TLS') ?? '').toLowerCase(),
    );
    const rejectUnauthorized =
      (
        this.configService.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') ??
        'true'
      ).toLowerCase() !== 'false';

    this.publisher = new Redis({
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

  async process(job: Job): Promise<any> {
    const { name } = job;

    if (name === 'price-feed') {
      const symbol = job.data.symbol;
      try {
        const url = `https://financialmodelingprep.com/api/v3/fx/${symbol}?apikey=${config.fmp_api_key}`;
        const response = await axios.get(url);

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
}
