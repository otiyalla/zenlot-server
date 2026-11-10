import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { getSharedConfigToken } from '@nestjs/bullmq';
import { QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { getBullMqWorkerConnection } from './bullmq-connections';

/**
 * Closes the shared BullMQ connections (queue and worker) on shutdown.
 * BullMQ never closes a connection it was handed, only the ones it created.
 *
 * This must be provided in AppModule. Nest runs shutdown hooks for the root
 * module last, so the queues and workers have already closed (and finished
 * any final commands) before these connections go away.
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
    if (!(connection instanceof Redis)) return;

    const workerConnection = getBullMqWorkerConnection(connection);
    const clients = workerConnection
      ? [connection, workerConnection]
      : [connection];
    await Promise.all(clients.map((client) => this.close(client)));
  }

  private async close(client: Redis): Promise<void> {
    if (client.status === 'end') return;
    try {
      await client.quit();
    } catch (error) {
      this.logger.warn(
        `Shared BullMQ connection ${client.options.connectionName ?? ''} did not quit cleanly: ${String(error)}`,
      );
      client.disconnect();
    }
  }
}
