
import { Injectable, OnModuleInit, INestApplication } from '@nestjs/common';
import { PrismaClient, Prisma } from '../../prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {

  constructor() {

    const options = {
      log: ['query', 'info', 'warn', 'error'],
    } as Prisma.PrismaClientOptions;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const adapter = new PrismaPg({ connectionString });
    //options.adapter = adapter;
    options.accelerateUrl = connectionString;

    super(options as Prisma.PrismaClientOptions);
  }

  async onModuleInit() {
    await this.$extends(withAccelerate()).$connect().then(() => {
      console.log('Prisma connected to the database');
    }).catch((error) => {
      console.error('Error connecting to the database: ', error);
    });
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close().then(() => {
        console.log('Prisma disconnected from the database');
      }).catch((error) => {
        console.error('Error disconnecting from the database: ', error);
      });
    });
  }

  async onModuleDestroy() {
    await this.$disconnect().then(() => {
      console.log('Prisma disconnected from the database');
    }).catch((error) => {
      console.error('Error disconnecting from the database: ', error);
    });
  }
}