import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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
