import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class AdminDeleteUserDto {
  @ApiProperty({
    description:
      'Email of the user being deleted. Must match the target account exactly (case-insensitive) as a safeguard against deleting the wrong id.',
    example: 'e2e+signup@zenlot.com',
  })
  @IsEmail()
  confirmEmail: string;
}
