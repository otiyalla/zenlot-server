import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsArray,
  IsIn,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// Names go into emails sent to unverified addresses: no markup, links or control characters.
const NAME_PATTERN = /^(?!.*:\/\/)(?!.*www\.)[^<>\p{Cc}]+$/iu;

class PipRuleDto {
  @IsNumber()
  @IsPositive()
  pips: number;
}

class ForexRuleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PipRuleDto)
  take_profit: PipRuleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PipRuleDto)
  stop_loss: PipRuleDto[];

  @IsOptional()
  @IsNumber()
  @IsPositive()
  lot_size?: number;
}

export class RulesDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ForexRuleDto)
  forex: ForexRuleDto;
}

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(256)
  @Matches(NAME_PATTERN, { message: 'fname must not contain links or markup' })
  fname: string;

  @IsString()
  @MinLength(2)
  @MaxLength(256)
  @Matches(NAME_PATTERN, { message: 'lname must not contain links or markup' })
  lname: string;

  @IsEmail()
  @MaxLength(256)
  email: string;

  @IsString()
  @IsIn(['en', 'fr', 'es'])
  language: string;

  @IsString()
  @IsOptional()
  @IsIn(['user', 'free', 'trader'])
  role: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  accountCurrency: string;

  @IsString()
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RulesDto)
  rules: RulesDto;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  timezone: string;

  @IsBoolean()
  @IsOptional()
  togglePipValue: boolean;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @ApiProperty({ description: 'The user tags' })
  tags: string[];
}
