import { AuthGuard } from './auth.guard';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { Reflector } from '@nestjs/core';
import { UserGateway } from '../user/user.gateway';
import { ConfigService } from '@nestjs/config';

describe('AuthGuard', () => {
  it('should be defined', () => {
    expect(
      new AuthGuard(
        new AuthService(
          new JwtService(),
          new UserService(new PrismaService(), new UserGateway()),
          new PrismaService(),
          new ConfigService(),
        ),
        new Reflector(),
      ),
    ).toBeDefined();
  });
});
