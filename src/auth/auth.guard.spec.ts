import { AuthGuard } from './auth.guard';
import { jwtConstants } from './auth.constants';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { Reflector } from '@nestjs/core';
import { UserGateway } from '../user/user.gateway';

describe('AuthGuard', () => {
  it('should be defined', () => {
    expect(new AuthGuard(new JwtService(), new AuthService(new JwtService(), new UserService(new PrismaService(), new UserGateway()), new PrismaService()), new Reflector())).toBeDefined();
  });
});
