import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { HistoryModule } from './history/history.module';
import { AuthModule } from './auth/auth.module';
import { JournalModule } from './journal/journal.module';
import { PriceFeedModule } from './price-feed/price-feed.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { TradeModule } from './trade/trade.module';
import { QuoteModule } from './quote/quote.module';
import { mapDatabaseUrl } from './config/database.config';
import { FeedbackModule } from './feedback/feedback.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';

function getEnvFilePath(): string[] {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  const envFiles: string[] = [];

  if (nodeEnv === 'local') {
    envFiles.push('.env.local');
  } else if (nodeEnv === 'dev' || nodeEnv === 'development') {
    envFiles.push('.env.dev');
  } else if (nodeEnv === 'production' || nodeEnv === 'prod') {
    envFiles.push('.env.prod');
  }

  envFiles.push('.env');

  return envFiles;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePath(),
      load: [
        // Map database URL after env files are loaded
        () => {
          mapDatabaseUrl();
          return {};
        },
      ],
    }),
    UserModule,
    HistoryModule,
    AuthModule,
    JournalModule,
    PriceFeedModule,
    JobsModule,
    PrismaModule,
    TradeModule,
    FeedbackModule,
    AuditModule,
    EmailModule,
    SentryModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST');
        const port = Number(config.get<string>('REDIS_PORT') ?? 6379);
        const username = config.get('REDIS_USERNAME');
        const password = config.get<string>('REDIS_PASSWORD');
        const tlsEnabled = ['1', 'true', 'yes'].includes(
          (config.get<string>('REDIS_TLS') ?? '').toLowerCase(),
        );
        const rejectUnauthorized =
          (
            config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') ?? 'true'
          ).toLowerCase() !== 'false';

        return {
          connection: {
            host,
            port,
            ...{ password, username },
            ...(tlsEnabled
              ? { tls: { servername: host, rejectUnauthorized } }
              : {}),
          },
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 1000,
            removeOnFail: 3500,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: 'price-feed',
      //defaultJobOptions: {}
    }),
    BullModule.registerQueue({
      name: 'deletion',
    }),
    QuoteModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
