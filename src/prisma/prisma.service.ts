
import { Injectable, OnModuleInit, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {

  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    await this.$connect().then(() => {
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