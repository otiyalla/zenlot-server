import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UserGateway } from './user.gateway';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    EmailModule,
    AnalyticsModule,
    BullModule.registerQueue({
      name: 'deletion',
    }),
  ],
  controllers: [UserController],
  providers: [UserService, UserGateway],
  exports: [UserService],
})
export class UserModule {}
