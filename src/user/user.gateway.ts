import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors.config';

interface AccessTokenPayload {
  sub?: unknown;
  id?: unknown;
}

interface AuthenticatedSocketData {
  userId: string;
}

type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  AuthenticatedSocketData
>;

export interface UserUpdateEvent {
  id?: unknown;
  fname?: unknown;
  lname?: unknown;
  email?: unknown;
  role?: unknown;
  tags?: unknown;
  language?: unknown;
  accountCurrency?: unknown;
  theme?: unknown;
  rules?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  timezone?: unknown;
  togglePipValue?: unknown;
  deletedAt?: unknown;
  deleteScheduledFor?: unknown;
  emailVerified?: unknown;
  daysRemaining?: unknown;
}

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: 'user',
})
export class UserGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Namespace;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authenticate(socket as AuthenticatedSocket)
        .then(() => next())
        .catch(() => next(new Error('Unauthorized')));
    });
  }

  emitUserUpdate(userId: string, user: UserUpdateEvent): void {
    this.server
      .to(this.getUserRoom(userId))
      .emit('updated-user', this.toSafeUserUpdate(user));
  }

  private async authenticate(socket: AuthenticatedSocket): Promise<void> {
    const token = this.extractAccessToken(socket);
    if (!token) {
      throw new Error('Missing access token');
    }

    const payload =
      await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    const userId = this.getVerifiedUserId(payload);
    if (!userId) {
      throw new Error('Access token has no valid user identity');
    }

    socket.data.userId = userId;
    await socket.join(this.getUserRoom(userId));
  }

  private extractAccessToken(socket: Socket): string | undefined {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;

    if (auth && Object.prototype.hasOwnProperty.call(auth, 'accessToken')) {
      return this.asNonEmptyString(auth.accessToken);
    }

    if (auth && Object.prototype.hasOwnProperty.call(auth, 'token')) {
      return this.asNonEmptyString(auth.token);
    }

    const authorization = socket.handshake.headers.authorization;
    if (authorization !== undefined) {
      if (typeof authorization !== 'string') return undefined;
      const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
      return match ? match[1] : undefined;
    }

    return this.asNonEmptyString(socket.handshake.headers.accesstoken);
  }

  private getVerifiedUserId(payload: AccessTokenPayload): string | undefined {
    return (
      this.asNonEmptyString(payload.sub) ?? this.asNonEmptyString(payload.id)
    );
  }

  private asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  private toSafeUserUpdate(user: UserUpdateEvent): UserUpdateEvent {
    return {
      id: user.id,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      role: user.role,
      tags: user.tags,
      language: user.language,
      accountCurrency: user.accountCurrency,
      theme: user.theme,
      rules: user.rules,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      timezone: user.timezone,
      togglePipValue: user.togglePipValue,
      deletedAt: user.deletedAt,
      deleteScheduledFor: user.deleteScheduledFor,
      emailVerified: user.emailVerified,
      daysRemaining: user.daysRemaining,
    };
  }
}
