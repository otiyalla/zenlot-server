import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({
    description: 'Expo push token, e.g. ExponentPushToken[xxxxxxxx]',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    description: 'Device platform',
    enum: ['ios', 'android', 'web'],
  })
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @ApiPropertyOptional({
    description:
      'Stable per-install device id so re-registration updates in place',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Human-readable device name' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceName?: string;
}
