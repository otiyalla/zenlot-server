import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class VerifyTokenDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  refreshToken: string;
}

export class EmailDto {
  @IsEmail()
  email: string;
}

export class ConfirmPasswordResetDto {
  /** The token from the emailed reset link. */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token: string;

  /** Same rule as sign-up and password change. */
  @IsString()
  @MinLength(8)
  password: string;
}
