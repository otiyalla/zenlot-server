import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class AdminFindUsersDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring to match against user emails (e.g. "e2e").',
    example: 'e2e',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  email?: string;
}
