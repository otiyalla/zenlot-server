import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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

/**
 * Retain a user's auth-version floor briefly after their last socket leaves.
 * This covers a handshake that verified just before a version advance but has
 * not registered yet, without retaining disconnected users for process life.
 */
export const AUTH_VERSION_FLOOR_GRACE_MS = 30_000;

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

interface AuthVersionFloor {
  cleanupTimer?: NodeJS.Timeout;
  version: number;
}

@Injectable()
export class SocketSessionRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(SocketSessionRegistry.name);
  private readonly minimumAuthVersions = new Map<string, AuthVersionFloor>();
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
    const floor = this.minimumAuthVersions.get(userId);
    if (floor && authVersion < floor.version) {
      this.revoke(socket, namespace);
      return false;
    }

    if (!floor || authVersion > floor.version) {
      this.advanceAuthVersion(userId, authVersion);
    }
    this.cancelFloorExpiry(this.minimumAuthVersions.get(userId));

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
    const currentFloor = this.minimumAuthVersions.get(userId);
    let floor = currentFloor;
    if (!floor || authVersion > floor.version) {
      this.cancelFloorExpiry(floor);
      floor = { version: authVersion };
      this.minimumAuthVersions.set(userId, floor);
    }

    const sessions = this.sessionsByUser.get(userId);
    if (!sessions) {
      this.scheduleFloorExpiry(userId, floor);
      return 0;
    }

    let disconnected = 0;
    for (const [key, session] of sessions) {
      if (session.authVersion >= floor.version) continue;

      this.revoke(session.socket, session.namespace);
      sessions.delete(key);
      disconnected += 1;
    }

    if (sessions.size === 0) {
      this.sessionsByUser.delete(userId);
      this.scheduleFloorExpiry(userId, floor);
    } else {
      this.cancelFloorExpiry(floor);
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
      const floor = this.minimumAuthVersions.get(userId);
      if (floor) this.scheduleFloorExpiry(userId, floor);
    }
  }

  private scheduleFloorExpiry(userId: string, floor: AuthVersionFloor): void {
    if (this.sessionsByUser.get(userId)?.size) return;

    this.cancelFloorExpiry(floor);
    const timer = setTimeout(() => {
      const currentFloor = this.minimumAuthVersions.get(userId);
      if (currentFloor !== floor || currentFloor.cleanupTimer !== timer) return;

      currentFloor.cleanupTimer = undefined;
      if (!this.sessionsByUser.get(userId)?.size) {
        this.minimumAuthVersions.delete(userId);
      }
    }, AUTH_VERSION_FLOOR_GRACE_MS);
    timer.unref?.();
    floor.cleanupTimer = timer;
  }

  private cancelFloorExpiry(floor?: AuthVersionFloor): void {
    if (!floor?.cleanupTimer) return;

    clearTimeout(floor.cleanupTimer);
    floor.cleanupTimer = undefined;
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

  onModuleDestroy(): void {
    for (const floor of this.minimumAuthVersions.values()) {
      this.cancelFloorExpiry(floor);
    }
    for (const sessions of this.sessionsByUser.values()) {
      for (const session of sessions.values()) {
        session.socket.off('disconnect', session.cleanup);
      }
    }
    this.minimumAuthVersions.clear();
    this.sessionsByUser.clear();
  }
}
