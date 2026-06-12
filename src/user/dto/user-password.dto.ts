import {
  IsString,
  MinLength,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class UserPasswordDto {
  @IsUUID()
  userId: string;

  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;

  @IsString()
  @IsOptional()
  @MinLength(8)
  confirmPassword?: string;
}
