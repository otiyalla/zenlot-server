import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { getSharedConfigToken } from '@nestjs/bullmq';
import { QueueOptions } from 'bullmq';
import Redis from 'ioredis';

/**
 * Closes the shared BullMQ connection on shutdown. BullMQ never closes a
 * connection it was handed, only the ones it created.
 *
 * This must be provided in AppModule. Nest runs shutdown hooks for the root
 * module last, so the queues and workers have already closed (and finished
 * any final commands) before this connection goes away.
 */
@Injectable()
export class BullMqConnectionCloser implements OnApplicationShutdown {
  private readonly logger = new Logger(BullMqConnectionCloser.name);

  constructor(
    @Inject(getSharedConfigToken())
    private readonly bullConfig: QueueOptions,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    const { connection } = this.bullConfig;
    if (!(connection instanceof Redis) || connection.status === 'end') return;

    try {
      await connection.quit();
    } catch (error) {
      this.logger.warn(
        `Shared BullMQ connection did not quit cleanly: ${String(error)}`,
      );
      connection.disconnect();
    }
  }
}
