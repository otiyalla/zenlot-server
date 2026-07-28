import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

export type AuthenticatedSocketNamespace =
  | '/user'
  | '/quote'
  | '/candle'
  | '/price-feed';

interface AuthenticatedSocketData {
  authSessionRevoked?: boolean;
}

type RegistrySocket = Pick<
  Socket,
  'id' | 'once' | 'off' | 'disconnect' | 'data' | 'rooms' | 'leave'
>;

const SESSION_REVOKED_KEY = 'authSessionRevoked';

export function isSocketSessionRevoked(socket: Pick<Socket, 'data'>): boolean {
  return (
    (socket.data as unknown as AuthenticatedSocketData | undefined)?.[
      SESSION_REVOKED_KEY
    ] === true
  );
}

interface SocketSession {
  authVersion: number;
  cleanup: () => void;
  namespace: AuthenticatedSocketNamespace;
  socket: RegistrySocket;
}

@Injectable()
export class SocketSessionRegistry {
  private readonly logger = new Logger(SocketSessionRegistry.name);
  private readonly minimumAuthVersions = new Map<string, number>();
  private readonly sessionsByUser = new Map<
    string,
    Map<string, SocketSession>
  >();

  register(
    socket: RegistrySocket,
    userId: string,
    authVersion: number,
    namespace: AuthenticatedSocketNamespace,
  ): boolean {
    const minimumVersion = this.minimumAuthVersions.get(userId);
    if (minimumVersion !== undefined && authVersion < minimumVersion) {
      this.revoke(socket, namespace);
      return false;
    }

    if (minimumVersion === undefined || authVersion > minimumVersion) {
      this.advanceAuthVersion(userId, authVersion);
    }

    const key = this.sessionKey(namespace, socket.id);
    const sessions =
      this.sessionsByUser.get(userId) ?? new Map<string, SocketSession>();
    const existing = sessions.get(key);
    if (existing) {
      existing.socket.off('disconnect', existing.cleanup);
    }

    const cleanup = () => this.unregister(userId, key, socket);
    socket.once('disconnect', cleanup);
    sessions.set(key, { authVersion, cleanup, namespace, socket });
    this.sessionsByUser.set(userId, sessions);
    return true;
  }

  advanceAuthVersion(userId: string, authVersion: number): number {
    const current = this.minimumAuthVersions.get(userId);
    const minimumVersion =
      current === undefined ? authVersion : Math.max(current, authVersion);
    this.minimumAuthVersions.set(userId, minimumVersion);

    const sessions = this.sessionsByUser.get(userId);
    if (!sessions) return 0;

    let disconnected = 0;
    for (const [key, session] of sessions) {
      if (session.authVersion >= minimumVersion) continue;

      this.revoke(session.socket, session.namespace);
      sessions.delete(key);
      disconnected += 1;
    }

    if (sessions.size === 0) {
      this.sessionsByUser.delete(userId);
    }
    return disconnected;
  }

  private unregister(
    userId: string,
    key: string,
    socket: RegistrySocket,
  ): void {
    const sessions = this.sessionsByUser.get(userId);
    if (!sessions || sessions.get(key)?.socket !== socket) return;

    sessions.delete(key);
    if (sessions.size === 0) {
      this.sessionsByUser.delete(userId);
    }
  }

  private sessionKey(
    namespace: AuthenticatedSocketNamespace,
    socketId: string,
  ): string {
    return `${namespace}:${socketId}`;
  }

  private revoke(
    socket: RegistrySocket,
    namespace: AuthenticatedSocketNamespace,
  ): void {
    (socket.data as unknown as AuthenticatedSocketData)[SESSION_REVOKED_KEY] =
      true;
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      try {
        void socket.leave(room);
      } catch (firstError) {
        try {
          void socket.leave(room);
        } catch (secondError) {
          this.logger.error(
            `Failed to leave stale ${namespace} socket ${socket.id} room ${room}`,
            new AggregateError([firstError, secondError]),
          );
        }
      }
    }

    try {
      socket.disconnect(true);
    } catch (firstError) {
      try {
        socket.disconnect(true);
      } catch (secondError) {
        this.logger.error(
          `Failed to disconnect stale ${namespace} socket ${socket.id}`,
          new AggregateError([firstError, secondError]),
        );
      }
    }
  }
}
