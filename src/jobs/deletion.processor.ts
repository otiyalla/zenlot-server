import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Job } from 'bullmq';
import { UserService } from '../user/user.service';

@Processor('deletion')
export class DeletionProcessor extends WorkerHost {
  private readonly logger = new Logger(DeletionProcessor.name);
  constructor(private readonly userService: UserService) {
    super();
  }

  async process(
    job: Job<{ userId: string }, { success: boolean; userId: string }, string>,
  ): Promise<{ success: boolean; userId: string }> {
    const {
      data: { userId },
      name,
    } = job;
    this.logger.log(
      `Processing deletion job for user ID: ${userId} , job name: ${name}`,
    );
    try {
      if (name === 'initiate-deletion') {
        await this.userService.initiateAccountDeletion(userId);
        this.logger.log(`Account deletion initiated for user ID: ${userId}`);
      }
      if (name === 'cancel-deletion') {
        await this.userService.cancelAccountDeletion(userId);
        this.logger.log(`Account deletion canceled for user ID: ${userId}`);
      }
      if (name === 'permanent-deletion') {
        await this.userService.permanentlyDeleteUser(userId);
        this.logger.log(`Account permanently deleted for user ID: ${userId}`);
      }
      return { success: true, userId };
    } catch (error) {
      this.logger.error(
        `Error processing job ${name} for user ID: ${userId}`,
        error,
      );
      Sentry.captureException(error, {
        extra: { jobName: name, userId, context: 'DeletionProcessor' },
      });
      throw error;
    }
  }
}
