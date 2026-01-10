import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '../../prisma/generated/prisma/client';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { UserGateway } from './user.gateway';
import { UserPasswordDto } from './dto/user-password.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userGateway: UserGateway
  ) {}

  async create(user: CreateUserDto) {
    const {email, fname, lname, role, language, accountCurrency, rules, tags} = user;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('User already exists with this email');
    const salt = await bcrypt.genSalt(10)
    const hashed = await bcrypt.hash(user.password, salt);
    
    const defaultRules = { forex: { take_profit: [], stop_loss: [] } };
    const rulesData = user.rules ? user.rules : defaultRules;
    
     const data: Prisma.userCreateInput = {
      fname: fname,
      lname: lname,
      email: email,
      role: role ?? 'trader',
      language: language,
      password: hashed,
      accountCurrency: accountCurrency,
      tags: tags || [],
      rules: rulesData as Prisma.InputJsonValue,
    };
    const result = await this.prisma.user.create({ data });
    return {
      ...result,
      password: undefined
    }
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

  async changePassword(dto: UserPasswordDto) {
    const {userId, currentPassword, newPassword} = dto;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.id) {
      throw new NotFoundException('password updated failed: user not found');
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return null;
    const success = await this.resetPassword(user.id, newPassword);
    return !!success;
  }

  async resetPassword(id: string, newPassword: string) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findAll() {
    return this.prisma.user.findMany();
  }

  async findOne(id: string): Promise< any | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async verifyEmailUpdate(id: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email === email) return true;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('Email already in use');
    return true;
  }

  //TODO: Test email update
  async update(id: string, dto: UpdateUserDto) {
    delete dto.id;
    if (dto.email) {
      await this.verifyEmailUpdate(id, dto.email);
    }
    const data: any = { ...dto, updatedAt: new Date()};
    const update = await this.prisma.user.update({ where: { id }, data });
    this.userGateway.server.emit('updated-user', { ...update, password: undefined });
  }
  
  async remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
