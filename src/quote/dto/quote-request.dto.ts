import { IsString, Matches } from 'class-validator';

export class QuoteRequestDto {
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  base: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  quote: string;
}
