import {
  Injectable,
  Logger,
  OnModuleInit,
  INestApplication,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaClient, Prisma } from '../../prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {

    const env = process.env.NODE_ENV?.toLowerCase();
    const options = {
      log: (env === "local") ? ['query', 'info', 'warn', 'error'] : [],
    } as Prisma.PrismaClientOptions;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const adapter = new PrismaPg({ connectionString });
    if (env === 'local') {
      options.adapter = adapter;
    } else {
      options.accelerateUrl = connectionString;
    }

    super(options);
  }

  async connectAccelerateDb() {
    return this.$extends(withAccelerate())
      .$connect()
      .then(() => {
        this.logger.log('Prisma connected to the database (Accelerate)');
      });
  }

  async connectLocalDb() {
    return this.$connect().then(() => {
      this.logger.log('Local database connected');
    });
  }

  async connectDb() {
    if (process.env.NODE_ENV?.toLowerCase() === 'local')
      return this.connectLocalDb();
    return this.connectAccelerateDb();
  }

  async onModuleInit() {
    try {
      await this.connectDb();
    } catch (error) {
      this.logger.error('Error connecting to the database', error);
      Sentry.captureException(error, {
        extra: { context: 'PrismaService.onModuleInit' },
      });
    }
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app
        .close()
        .then(() => {
          this.logger.log('Prisma disconnected from the database');
        })
        .catch((error) => {
          this.logger.error('Error disconnecting from the database', error);
          Sentry.captureException(error, {
            extra: { context: 'PrismaService.enableShutdownHooks' },
          });
        });
    });
  }

  async onModuleDestroy() {
    await this.$disconnect()
      .then(() => {
        this.logger.log('Prisma disconnected from the database');
      })
      .catch((error) => {
        this.logger.error('Error disconnecting from the database', error);
        Sentry.captureException(error, {
          extra: { context: 'PrismaService.onModuleDestroy' },
        });
      });
  }
}
