import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'This is Zenlot Server';
  }

  /**
   * Health check for load balancers and orchestration.
   * Returns 200 when DB is reachable; 503 when it is not.
   */
  async healthCheck(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }
  }
}
