import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { JournalModule } from './journal/journal.module';
import { PriceFeedModule } from './price-feed/price-feed.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { TradeModule } from './trade/trade.module';
import { RiskModule } from './risk/risk.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { QuoteModule } from './quote/quote.module';
import { CandleModule } from './candle/candle.module';
import { mapDatabaseUrl } from './config/database.config';
import {
  createBullMqConnections,
  SharedConnectionWorker,
} from './config/bullmq-connections';
import { BullMqConnectionCloser } from './config/bullmq-connection.closer';
import { FeedbackModule } from './feedback/feedback.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';

// Run every @Processor on the shared worker connection (see
// createBullMqConnections) instead of the queue connection.
BullModule.workerClass = SharedConnectionWorker;

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
    AuthModule,
    JournalModule,
    PriceFeedModule,
    JobsModule,
    PrismaModule,
    TradeModule,
    RiskModule,
    EvaluationModule,
    CandleModule,
    FeedbackModule,
    AuditModule,
    EmailModule,
    NotificationsModule,
    SentryModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          // Shared queue connection, with the shared worker connection
          // attached; see createBullMqConnections. Closed by
          // BullMqConnectionCloser.
          connection: createBullMqConnections(config),
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
    BullMqConnectionCloser,
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
