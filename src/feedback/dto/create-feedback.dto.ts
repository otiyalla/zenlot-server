import {
  IsEmail,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsIn,
  IsUUID,
} from 'class-validator';

export class CreateFeedbackDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @IsIn(['bug', 'feature', 'feedback', 'challenge'])
  type?: 'bug' | 'feature' | 'feedback' | 'challenge';

  @IsOptional()
  @IsUUID()
  userId?: string;
}
