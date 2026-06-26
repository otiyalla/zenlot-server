import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional({ description: 'Master push switch' })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tradeClosed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachingReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  drawdownAlerts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  governanceAlerts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  journalReminders?: boolean;

  @ApiPropertyOptional({
    description:
      'Hour of day (0–23, local time) to send the journaling reminder.',
    minimum: 0,
    maximum: 23,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderHour?: number;

  @ApiPropertyOptional({
    description:
      'Quiet-hours start in local time, "HH:mm" 24h. Send null to clear.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(HH_MM, { message: 'quietHoursStart must be HH:mm (24h)' })
  quietHoursStart?: string | null;

  @ApiPropertyOptional({
    description:
      'Quiet-hours end in local time, "HH:mm" 24h. Send null to clear.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(HH_MM, { message: 'quietHoursEnd must be HH:mm (24h)' })
  quietHoursEnd?: string | null;
}
