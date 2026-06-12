import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class UserPasswordDto {
  @IsUUID()
  @ApiProperty({ description: 'The user id' })
  userId: string;

  @IsString()
  @MinLength(8)
  @ApiProperty({ description: 'The user current password' })
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @ApiProperty({ description: 'The user new password' })
  newPassword: string;

  @IsString()
  @IsOptional()
  @MinLength(8)
  @ApiProperty({ description: 'The user confirm password' })
  confirmPassword?: string;
}
