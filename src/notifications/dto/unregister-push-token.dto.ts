import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UnregisterPushTokenDto {
  @ApiProperty({ description: 'Expo push token to remove' })
  @IsString()
  @MaxLength(512)
  token!: string;
}
