import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SocketSessionModule } from '../auth/socket-session.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AnalyticsModule,
    SocketSessionModule,
    BullModule.registerQueue({ name: 'deletion' }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
