import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { HistoryModule } from './history/history.module';
import { AuthModule } from './auth/auth.module';
import { JournalModule } from './journal/journal.module';
import { PriceFeedModule } from './price-feed/price-feed.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { TradeModule } from './trade/trade.module';
import { config } from './config/config.constant';
import { QuoteGateway } from './quote/quote.gateway';
import { QuoteModule } from './quote/quote.module';
import { QuoteService } from './quote/quote.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    UserModule, 
    HistoryModule, 
    AuthModule, 
    JournalModule, 
    PriceFeedModule, 
    JobsModule, 
    PrismaModule, 
    TradeModule,
    BullModule.forRoot({
      connection: {
        host: config.redis_host,
        port: Number(config.redis_port)
      },
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 1000,
        removeOnFail: 3500
      }
    }),
    BullModule.registerQueue({
      name: 'price-feed',
      //defaultJobOptions: {}
    }),
    QuoteModule
  ],
  controllers: [AppController],
  providers: [AppService, QuoteGateway, QuoteService ],
})
export class AppModule {}
