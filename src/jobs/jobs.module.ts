import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DeletionProcessor } from './deletion.processor';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deletion',
    }),
    UserModule,
  ],
  providers: [DeletionProcessor],
})
export class JobsModule {}
