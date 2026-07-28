import { Module } from '@nestjs/common';
import { SocketSessionRegistry } from './socket-session-registry.service';

@Module({
  providers: [SocketSessionRegistry],
  exports: [SocketSessionRegistry],
})
export class SocketSessionModule {}
