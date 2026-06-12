import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsUUID,
  IsString,
} from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsDate()
  createdAt: Date;

  @IsDate()
  updatedAt: Date;

  @IsDate()
  @IsOptional()
  deletedAt?: Date;

  @IsDate()
  @IsOptional()
  deleteScheduledFor?: Date;

  @IsBoolean()
  emailVerified: boolean;

  @IsString()
  @IsOptional()
  emailVerificationToken?: string;

  @IsDate()
  @IsOptional()
  emailVerificationTokenExpiry?: Date;
}
