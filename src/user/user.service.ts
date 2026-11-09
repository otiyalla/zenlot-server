import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { UserGateway } from './user.gateway';
import { UserPasswordDto } from './dto/user-password.dto';
import { DEFAULT_USER_ROLE } from '../auth/roles.constants';
import { deleteUserWithData, DeletedUserData } from './user-deletion';

/**
 * Every user column except `password`. Use this for anything returned from a
 * user endpoint or broadcast to clients so the bcrypt hash never leaves the
 * server.
 */
export const SAFE_USER_SELECT = {
  id: true,
  fname: true,
  lname: true,
  email: true,
  role: true,
  tags: true,
  language: true,
  accountCurrency: true,
  theme: true,
  rules: true,
  createdAt: true,
  updatedAt: true,
  timezone: true,
  togglePipValue: true,
} as const satisfies Prisma.userSelect;

export type SafeUser = Prisma.userGetPayload<{ select: typeof SAFE_USER_SELECT }>;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userGateway: UserGateway
  ) {}

  async create(user: CreateUserDto) {
    const {email, fname, lname, language, accountCurrency, rules} = user;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('User already exists with this email');
    const salt = await bcrypt.genSalt(10)
    const hashed = await bcrypt.hash(user.password, salt);
     const data = {
      fname: fname,
      lname: lname,
      email: email,
      // Never trust a client-supplied role: self-registration must not be able
      // to create admins. Admins are promoted directly in the database.
      role: DEFAULT_USER_ROLE,
      language: language,
      password: hashed,
      accountCurrency: accountCurrency,
      rules: user.rules ? JSON.parse(JSON.stringify(rules)) : undefined,
    };
    return this.prisma.user.create({ data, select: SAFE_USER_SELECT });
  }

  async validateUser(email: string, password: string): Promise<AuthenticatedUser | null>{
    const user = await this.prisma.user.findUnique({ where: { email } });
    console.log('validating user: ', user);
    if (!user) return null;

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;
   
    const newUser =  { ...user, password: undefined };

    return {
      ...newUser,
      rules: typeof user.rules === 'string'
        ? JSON.parse(user.rules)
        : user.rules && typeof user.rules === 'object'
        ? user.rules
        : { forex: { take_profit: [], stop_loss: [] } },
    };
  }
  
  async signin(user: CreateUserDto) {
    const userFound = await this.prisma.user.findUnique({ where: { email: user.email } });
    
    if (!userFound) throw new NotFoundException('User not found');
    try {
        const isMatch = await bcrypt.compare(userFound.password, user.password);
        if (!isMatch) throw new NotFoundException('User information is incorrect');
        const newUser = { ...userFound, password: undefined, rules: userFound.rules };
        return newUser;
    } catch (error) {
        console.error('error found in user: ', error);
    }
  }

  /**
   * `userId` must come from the authorization layer (the authenticated user,
   * or a target an admin is allowed to act on), never straight from the body.
   */
  async changePassword(userId: number, dto: UserPasswordDto) {
    const {currentPassword, newPassword} = dto;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.id) {
      throw new NotFoundException('password updated failed: user not found');
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return null;
    const success = await this.resetPassword(user.id, newPassword);
    return !!success;
  }

  async resetPassword(id: number, newPassword: string) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: { id: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findOne(id: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async verifyEmailUpdate(id: number, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email === email) return true;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('Email already in use');
    return true;
  }

  //TODO: Test email update
  async update(id: number, dto: UpdateUserDto) {
    delete dto.id;
    // Users cannot change their own role (e.g. escalate to admin).
    delete dto.role;
    if (dto.email) {
      await this.verifyEmailUpdate(id, dto.email);
    }
    const data: any = { ...dto, updatedAt: new Date()};
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_USER_SELECT,
    });
    this.userGateway.server.emit('updated-user', updated);
    return updated;
  }

  /**
   * Deletes the user together with their journals, trades and refresh tokens.
   * A plain `user.delete` fails for anyone with trades because `trade.userId`
   * is `ON DELETE RESTRICT`.
   */
  async remove(id: number): Promise<{ id: number; deleted: DeletedUserData }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const deleted = await deleteUserWithData(this.prisma, id);
    return { id, deleted };
  }
}
